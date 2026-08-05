import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";

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
memo.post("/", async (c) => {
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
