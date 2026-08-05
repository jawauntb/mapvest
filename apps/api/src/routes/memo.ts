import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";

/**
 * Investment-memo + SEC endpoints — thin proxies over the sibling
 * `underlying-analyzer-reboot` service. That project already does SEC EDGAR,
 * Exa enrichment, and an Anthropic-authored brief; we just forward.
 *
 * See docs/SYSTEM_DESIGN.md D10 for the sibling-repo-boundary decision.
 */

const UNDERLYING_URL =
  process.env.UNDERLYING_URL ?? "https://underlying-terminal-production.up.railway.app";

const memo = new Hono();

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
    const res = await fetch(`${UNDERLYING_URL}/api/analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker }),
    });
    span.setAttributes({
      upstream_status: res.status,
      upstream_latency_ms: Math.round(performance.now() - started),
    });
    if (!res.ok) return c.json({ error: `underlying ${res.status}` }, 502);
    const j = (await res.json()) as Record<string, unknown>;

    // Underlying returns memos keyed by provider — "Anthropic Brief",
    // "OpenAI Brief", etc. Pick the first non-empty markdown blob.
    let memoText: string | undefined;
    let provider: string | undefined;
    for (const [k, v] of Object.entries(j)) {
      if (typeof v === "string" && v.trim().length > 100 && k.toLowerCase().includes("brief")) {
        memoText = v;
        provider = k.replace(/\s*Brief\s*$/i, "").toLowerCase();
        break;
      }
    }
    if (!memoText) {
      return c.json({ error: "no memo returned by underlying analyzer" }, 502);
    }
    return c.json({
      ticker,
      provider: provider ?? "unknown",
      memo: memoText,
      raw: j, // full payload preserved for callers who want it
    });
  });
});

/**
 * GET /v1/sec/:ticker → SEC 10-K citations (CIK, filing date, item URLs).
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
