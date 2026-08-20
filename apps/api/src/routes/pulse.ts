/**
 * Demand pulse (Universe Roadmap §3 C3).
 *
 * Routes:
 *   GET /v1/pulse/:ticker → DemandPulse
 *
 * Same metering posture as `GET /v1/graph/:ticker`: serving a cached pulse is
 * free and identity-less, while a cache MISS spends provider money (income
 * statement + cash flow per buyer, up to six buyers) and is therefore metered —
 * the caller must be identified (bearer session or `X-Device-Id`) and pass the
 * free-tier quota.
 *
 * Reading the pulse never triggers graph generation. A ticker with no stored
 * edges returns a well-formed `pulse: null` / `interpretation: "unknown"`
 * response, not an extraction run and not a guess.
 */
import type { DemandPulse, User } from "@mapvest/core";
import { Hono } from "hono";
import { buildDemandPulse, readDemandPulseCache } from "../lib/demand-pulse.js";
import { MONTHLY_PRICE_USD, getEntitlementState, recordGeneration } from "../lib/entitlements.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { isTicker } from "../lib/underlying.js";
import { optionalAuth } from "../middleware/optionalAuth.js";
import { deviceIdFromRequest } from "../middleware/requireGenerationQuota.js";

const inFlight = new Map<string, Promise<DemandPulse>>();

const pulse = new Hono();

pulse.get("/:ticker", optionalAuth, async (c) => {
  return safeExecuteWithSpan("http.pulse", async (span) => {
    const ticker = c.req.param("ticker").trim().toUpperCase();
    if (!isTicker(ticker)) {
      span.setAttribute("error.kind", "invalid_ticker");
      return c.json({ error: "invalid ticker" }, 400);
    }
    span.setAttribute("ticker", ticker);

    const cached = readDemandPulseCache(ticker);
    if (cached) {
      span.setAttributes({ cache: "hit", interpretation: cached.interpretation });
      return c.json(cached);
    }

    // Past this point the build spends provider money — meter it exactly like
    // /v1/graph. Cache hits above stay free and identity-less.
    const user = (c as unknown as { get: (k: string) => User | undefined }).get("user");
    const deviceId = deviceIdFromRequest(c);
    if (!user && !deviceId) {
      span.setAttribute("error.kind", "no_identity");
      return c.json(
        { error: "X-Device-Id header (or a bearer session) required to generate a pulse" },
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

    let pending = inFlight.get(ticker);
    const shared = Boolean(pending);
    if (!pending) {
      pending = buildDemandPulse(ticker).finally(() => inFlight.delete(ticker));
      inFlight.set(ticker, pending);
    }
    span.setAttributes({ cache: "miss", in_flight_shared: shared });

    let result: DemandPulse;
    try {
      result = await pending;
    } catch (err) {
      span.setAttribute("error.kind", "pulse_failed");
      return c.json({ error: err instanceof Error ? err.message : "demand pulse failed" }, 502);
    }

    // Charge only the caller that initiated the build; concurrent callers that
    // shared the in-flight promise consumed no additional provider calls.
    if (!shared) {
      await recordGeneration({ userId: user?.id, deviceId, kind: "pulse" }).catch(() => {});
    }

    span.setAttributes({ interpretation: result.interpretation, buyers: result.buyers.length });
    return c.json(result);
  });
});

export default pulse;
