/**
 * Environment layer (Universe Roadmap §3 C4).
 *
 * Routes:
 *   GET /v1/environment/:sector → EnvironmentBrief
 *
 * `:sector` is a free-form label resolved through the canonical GICS map in
 * `packages/finance/src/etf-map.ts` ("tech" and "Information Technology" both
 * land on the same brief); an unrecognized label is a 400 rather than an
 * unbounded cache key that would spend Exa money on junk.
 *
 * Same metering posture as `GET /v1/graph/:ticker`: a cached brief is free and
 * identity-less; a cache MISS spends FRED + Exa + OpenRouter and is metered.
 *
 * 503 only when the brief has no possible inputs (neither `FRED_API_KEY` nor
 * `EXA_API_KEY`, or no `OPENROUTER_API_KEY`). With one of the two evidence keys
 * present the generator degrades — a brief without series, or without web color
 * — rather than refusing, because a thinner honest brief beats no brief.
 */
import type { EnvironmentBrief, User } from "@mapvest/core";
import { Hono } from "hono";
import { MONTHLY_PRICE_USD, getEntitlementState, recordGeneration } from "../lib/entitlements.js";
import {
  environmentBriefAvailability,
  generateEnvironmentBrief,
  readEnvironmentBriefCache,
  resolveSector,
} from "../lib/environment-brief-generator.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { optionalAuth } from "../middleware/optionalAuth.js";
import { deviceIdFromRequest } from "../middleware/requireGenerationQuota.js";

/** Guards the cache key and the Exa spend against absurd path segments. */
const MAX_SECTOR_LENGTH = 64;

const inFlight = new Map<string, Promise<EnvironmentBrief>>();

const environment = new Hono();

environment.get("/:sector", optionalAuth, async (c) => {
  return safeExecuteWithSpan("http.environment", async (span) => {
    const raw = c.req.param("sector").trim();
    if (!raw || raw.length > MAX_SECTOR_LENGTH) {
      span.setAttribute("error.kind", "invalid_sector");
      return c.json({ error: "invalid sector" }, 400);
    }
    const sector = resolveSector(raw);
    if (!sector) {
      span.setAttribute("error.kind", "unknown_sector");
      return c.json({ error: `unknown sector: ${raw}` }, 400);
    }
    span.setAttribute("sector", sector);

    const cached = readEnvironmentBriefCache(sector);
    if (cached) {
      span.setAttributes({ cache: "hit", series: cached.series.length });
      return c.json(cached);
    }

    const availability = environmentBriefAvailability();
    if (!availability.ok) {
      span.setAttribute("error.kind", "not_configured");
      return c.json({ error: availability.error }, 503);
    }

    // Past this point generation spends FRED + Exa + OpenRouter money — meter it
    // exactly like /v1/graph. Cache hits above stay free and identity-less.
    const user = (c as unknown as { get: (k: string) => User | undefined }).get("user");
    const deviceId = deviceIdFromRequest(c);
    if (!user && !deviceId) {
      span.setAttribute("error.kind", "no_identity");
      return c.json(
        { error: "X-Device-Id header (or a bearer session) required to generate a brief" },
        400,
      );
    }
    const state = await getEntitlementState({ userId: user?.id, deviceId, email: user?.email });
    if (!state.canGenerate) {
      span.setAttribute("error.kind", "quota_exceeded");
      return c.json(
        {
          error: "generation quota exceeded",
          code: "quota_exceeded" as const,
          remaining: state.remaining,
          limit: state.limit,
          priceUsd: MONTHLY_PRICE_USD,
          interval: "month" as const,
        },
        402,
      );
    }

    let pending = inFlight.get(sector);
    const shared = Boolean(pending);
    if (!pending) {
      pending = generateEnvironmentBrief(sector).finally(() => inFlight.delete(sector));
      inFlight.set(sector, pending);
    }
    span.setAttributes({ cache: "miss", in_flight_shared: shared });

    let brief: EnvironmentBrief;
    try {
      brief = await pending;
    } catch (err) {
      span.setAttribute("error.kind", "generation_failed");
      return c.json(
        { error: err instanceof Error ? err.message : "environment brief generation failed" },
        502,
      );
    }

    // Charge only the caller that initiated the generation; concurrent callers
    // that shared the in-flight promise consumed no additional provider calls.
    if (!shared) {
      await recordGeneration({ userId: user?.id, deviceId, kind: "environment" }).catch(() => {});
    }

    span.setAttributes({ series: brief.series.length, sources: brief.sources.length });
    return c.json(brief);
  });
});

export default environment;
