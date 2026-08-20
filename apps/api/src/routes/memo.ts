import type { SynthesisMemoResponse, User } from "@mapvest/core";
import { Hono } from "hono";
import { MONTHLY_PRICE_USD, getEntitlementState, recordGeneration } from "../lib/entitlements.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { onMemoFinished } from "../lib/notifiers/memoNotifier.js";
import { buildSynthesisMemo } from "../lib/synthesis-memo.js";
import { isTicker } from "../lib/underlying.js";
import { optionalAuth } from "../middleware/optionalAuth.js";
import {
  deviceIdFromRequest,
  requireGenerationQuota,
} from "../middleware/requireGenerationQuota.js";

/**
 * Investment-memo + SEC endpoints — thin proxies over the sibling
 * `underlying-analyzer-reboot` service. That project already does SEC EDGAR,
 * Exa enrichment, and an Anthropic-authored brief; we just forward.
 *
 * Upstream:
 *   GET  /api/analysis/<ticker>
 *   POST /api/analysis { tickers: [...] }
 *   GET  /api/sec/<ticker>
 *   POST /api/tools/vision/v2 { ticker }  (fallback memo)
 *
 * See docs/SYSTEM_DESIGN.md D10 for the sibling-repo-boundary decision.
 */

const UNDERLYING_URL =
  process.env.UNDERLYING_URL ?? "https://underlying-terminal-production.up.railway.app";

const memo = new Hono();

function pickBrief(j: Record<string, unknown>): { memoText?: string; provider?: string } {
  // Prefer named brief fields from /api/analysis
  for (const [k, v] of Object.entries(j)) {
    if (typeof v === "string" && v.trim().length > 100 && k.toLowerCase().includes("brief")) {
      return {
        memoText: v,
        provider: k.replace(/\s*Brief\s*$/i, "").toLowerCase(),
      };
    }
  }
  // Vision / Market Memo shapes
  for (const key of ["memo", "market_memo", "text", "brief", "content"]) {
    const v = j[key];
    if (typeof v === "string" && v.trim().length > 100) {
      return { memoText: v, provider: typeof j.provider === "string" ? j.provider : "underlying" };
    }
  }
  return {};
}

async function fetchAnalysis(ticker: string): Promise<Record<string, unknown>> {
  // Prefer GET single-ticker; fall back to documented POST batch shape.
  const getRes = await fetch(`${UNDERLYING_URL}/api/analysis/${encodeURIComponent(ticker)}`, {
    headers: { Accept: "application/json" },
  });
  if (getRes.ok) return (await getRes.json()) as Record<string, unknown>;

  const postRes = await fetch(`${UNDERLYING_URL}/api/analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ tickers: [ticker], ticker, max_results: 1 }),
  });
  if (!postRes.ok) {
    throw new Error(`underlying analysis ${postRes.status}`);
  }
  return (await postRes.json()) as Record<string, unknown>;
}

async function fetchVisionMemo(ticker: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${UNDERLYING_URL}/api/tools/vision/v2`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ticker }),
  });
  if (!res.ok) throw new Error(`underlying vision ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/**
 * POST /v1/memo  { ticker }
 * → { ticker, memo: string, provider: "anthropic"|"openai"|..., sources? }
 */
memo.post("/", optionalAuth, requireGenerationQuota("memo"), async (c) => {
  return safeExecuteWithSpan("http.memo", async (span) => {
    const body = await c.req.json().catch(() => null);
    const ticker = (body?.ticker ?? "").toString().trim().toUpperCase();
    if (!ticker) return c.json({ error: "ticker required" }, 400);
    span.setAttribute("ticker", ticker);

    const started = performance.now();
    let j: Record<string, unknown>;
    let path = "analysis";
    try {
      j = await fetchAnalysis(ticker);
    } catch (err) {
      span.setAttribute("analysis_error", (err as Error).message);
      try {
        j = await fetchVisionMemo(ticker);
        path = "vision_v2";
      } catch (err2) {
        return c.json(
          {
            error: `underlying memo failed: ${(err as Error).message}; vision: ${(err2 as Error).message}`,
          },
          502,
        );
      }
    }
    span.setAttributes({
      upstream_path: path,
      upstream_latency_ms: Math.round(performance.now() - started),
    });

    const { memoText, provider } = pickBrief(j);
    if (!memoText) {
      return c.json({ error: "no memo returned by underlying analyzer" }, 502);
    }
    // Fire-and-forget push for authenticated users. Anonymous callers can't
    // opt in to notifications, so we simply skip when no user is set.
    const memoUser = (c as unknown as { get: (k: string) => { id?: string } | undefined }).get(
      "user",
    );
    if (memoUser?.id) {
      onMemoFinished(memoUser.id, ticker).catch(() => {});
    }
    return c.json({
      ticker,
      provider: provider ?? "underlying",
      memo: memoText,
      sourceUrl: `${UNDERLYING_URL}/`,
      raw: j,
    });
  });
});

/**
 * POST /v1/memo/synthesis  { ticker } → SynthesisMemoResponse
 *
 * The layered memo (Universe Roadmap §3 C5): the value-chain graph, the demand
 * pulse above it, the sector environment brief, and the ratios are gathered
 * best-effort and handed to ONE model call that answers the three questions —
 * binding constraint, demand durability, pricing power.
 *
 * Metering posture is `GET /v1/graph/:ticker`'s: a cached memo is free and
 * identity-less; a miss spends provider money (up to three layer gathers plus
 * an OpenRouter cascade) and is metered as `kind: "synthesis"`, recorded only
 * once generation actually succeeded. Concurrent callers sharing the in-flight
 * generation are not double-charged. Reading the graph never generates one.
 */
const SYNTHESIS_TTL_MS = 24 * 60 * 60 * 1000;
const synthesisCache = new Map<string, { expiresAt: number; memo: SynthesisMemoResponse }>();
const synthesisInFlight = new Map<string, Promise<SynthesisMemoResponse>>();

function readSynthesisCache(ticker: string): SynthesisMemoResponse | null {
  const hit = synthesisCache.get(ticker);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    synthesisCache.delete(ticker);
    return null;
  }
  return hit.memo;
}

/** Test-only. Public callers should not reach in. */
export function _clearSynthesisMemoCache(): void {
  synthesisCache.clear();
  synthesisInFlight.clear();
}

memo.post("/synthesis", optionalAuth, async (c) => {
  return safeExecuteWithSpan("http.memo_synthesis", async (span) => {
    const body = await c.req.json().catch(() => null);
    const ticker = (body?.ticker ?? "").toString().trim().toUpperCase();
    if (!isTicker(ticker)) {
      span.setAttribute("error.kind", "invalid_ticker");
      return c.json({ error: "invalid ticker" }, 400);
    }
    span.setAttribute("ticker", ticker);

    const cached = readSynthesisCache(ticker);
    if (cached) {
      span.setAttributes({ cache: "hit", sources: cached.sources.length });
      return c.json(cached);
    }

    // Past this point generation spends provider money — meter it exactly like
    // /v1/graph. Cache hits above stay free and are never re-recorded.
    const user = (c as unknown as { get: (k: string) => User | undefined }).get("user");
    const deviceId = deviceIdFromRequest(c);
    if (!user && !deviceId) {
      span.setAttribute("error.kind", "no_identity");
      return c.json(
        { error: "X-Device-Id header (or a bearer session) required to generate a memo" },
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

    let pending = synthesisInFlight.get(ticker);
    const shared = Boolean(pending);
    if (!pending) {
      pending = buildSynthesisMemo(ticker).finally(() => synthesisInFlight.delete(ticker));
      synthesisInFlight.set(ticker, pending);
    }
    span.setAttributes({ cache: "miss", in_flight_shared: shared });

    let synthesis: SynthesisMemoResponse;
    try {
      synthesis = await pending;
    } catch (err) {
      span.setAttribute("error.kind", "generation_failed");
      return c.json(
        { error: err instanceof Error ? err.message : "synthesis memo generation failed" },
        502,
      );
    }

    synthesisCache.set(ticker, { memo: synthesis, expiresAt: Date.now() + SYNTHESIS_TTL_MS });
    // Charge only the caller that initiated the generation; concurrent callers
    // that shared the in-flight promise consumed no additional provider calls.
    if (!shared) {
      await recordGeneration({ userId: user?.id, deviceId, kind: "synthesis" }).catch(() => {});
    }

    span.setAttribute("sources", synthesis.sources.length);
    return c.json(synthesis);
  });
});

/**
 * GET /v1/memo/sec/:ticker → SEC 10-K citations (CIK, filing date, item URLs).
 */
memo.get("/sec/:ticker", async (c) => {
  return safeExecuteWithSpan("http.sec", async (span) => {
    const ticker = c.req.param("ticker").trim().toUpperCase();
    span.setAttribute("ticker", ticker);
    const res = await fetch(`${UNDERLYING_URL}/api/sec/${ticker}`);
    span.setAttribute("upstream_status", res.status);
    if (!res.ok) return c.json({ error: `underlying sec ${res.status}` }, 502);
    return c.json(await res.json());
  });
});

export default memo;
