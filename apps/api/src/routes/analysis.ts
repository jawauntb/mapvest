import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { UNDERLYING_URL, isTicker, upstreamFetch } from "../lib/underlying.js";

/**
 * Lightweight analysis snapshot from Underlying Analyzer.
 * GET /v1/analysis/:ticker → summary fields (+ brief when present).
 * Full Anthropic brief still via POST /v1/memo.
 */

const analysis = new Hono();

type UpstreamAnalysis = {
  ticker?: string;
  symbol?: string;
  name?: string;
  company_name?: string;
  sector?: string;
  industry?: string;
  price?: number;
  current_price?: number;
  change?: number;
  change_percent?: number;
  changePercent?: number;
  market_cap?: string | number;
  marketCap?: string | number;
  trailing_pe?: string | number;
  trailingPe?: string | number;
  annual_volatility?: number;
  annualVolatility?: number;
  fifty_two_week_high?: number;
  fiftyTwoWeekHigh?: number;
  fifty_two_week_low?: number;
  fiftyTwoWeekLow?: number;
  brief?: string;
  analysis?: string;
  summary?: string;
  provider?: string;
  brief_provider?: string;
  error?: string;
  quote?: Record<string, unknown>;
  fundamentals?: Record<string, unknown>;
};

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function pickBrief(j: UpstreamAnalysis): string | undefined {
  for (const k of [j.brief, j.analysis, j.summary] as const) {
    if (typeof k === "string" && k.trim().length > 40) return k.trim();
  }
  return undefined;
}

analysis.get("/:ticker", async (c) => {
  return safeExecuteWithSpan("http.analysis", async (span) => {
    const ticker = (c.req.param("ticker") ?? "").trim().toUpperCase();
    if (!isTicker(ticker)) {
      return c.json({ error: "ticker required (e.g. MCD)" }, 400);
    }
    span.setAttributes({ ticker, upstream: UNDERLYING_URL });

    const started = performance.now();
    const res = await upstreamFetch(`/api/analysis/${encodeURIComponent(ticker)}`, {
      method: "GET",
      timeoutMs: 30_000,
    });
    span.setAttributes({
      upstream_status: res.status,
      upstream_latency_ms: Math.round(performance.now() - started),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return c.json(
        { error: `underlying analysis ${res.status}`, detail: text.slice(0, 300) },
        502,
      );
    }

    const j = (await res.json()) as UpstreamAnalysis;
    const quote = (j.quote ?? {}) as Record<string, unknown>;
    const fund = (j.fundamentals ?? {}) as Record<string, unknown>;
    const brief = pickBrief(j);

    return c.json({
      ticker,
      name: j.name ?? j.company_name ?? (typeof quote.name === "string" ? quote.name : undefined),
      sector: j.sector ?? (typeof fund.sector === "string" ? fund.sector : undefined),
      industry: j.industry ?? (typeof fund.industry === "string" ? fund.industry : undefined),
      price: num(j.price ?? j.current_price ?? quote.price ?? quote.regularMarketPrice),
      change: num(j.change ?? quote.change),
      changePercent: num(j.changePercent ?? j.change_percent ?? quote.changePercent),
      marketCap: j.marketCap ?? j.market_cap ?? fund.marketCap ?? fund.market_cap,
      trailingPe: j.trailingPe ?? j.trailing_pe ?? fund.trailingPE ?? fund.trailing_pe,
      annualVolatility: num(j.annualVolatility ?? j.annual_volatility ?? fund.annualVolatility),
      fiftyTwoWeekHigh: num(
        j.fiftyTwoWeekHigh ?? j.fifty_two_week_high ?? quote.fiftyTwoWeekHigh,
      ),
      fiftyTwoWeekLow: num(j.fiftyTwoWeekLow ?? j.fifty_two_week_low ?? quote.fiftyTwoWeekLow),
      brief,
      briefProvider: brief ? j.brief_provider ?? j.provider : undefined,
      sourceUrl: `${UNDERLYING_URL}/`,
    });
  });
});

export default analysis;
