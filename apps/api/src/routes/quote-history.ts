import { getHistoricalClosesWithProvider } from "@mapvest/finance";
import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { marketDataSource } from "../lib/marketDataSource.js";
import { type Period, VALID_PERIODS } from "../lib/yahooHistory.js";

const quoteHistory = new Hono();

/**
 * GET /v1/quote-history?symbol=AAPL&period=1mo
 *
 * Daily closes for the native Overview price chart. Never invents prices —
 * 502 when the configured provider has no usable series.
 */
quoteHistory.get("/", async (c) => {
  return safeExecuteWithSpan("http.quote_history", async (span) => {
    const symbol = (c.req.query("symbol") ?? "").trim().toUpperCase();
    if (!symbol) {
      span.setAttribute("error.kind", "missing_symbol");
      return c.json({ error: "symbol required" }, 400);
    }

    const rawPeriod = (c.req.query("period") ?? "").trim();
    const period = (rawPeriod || "1mo") as Period;
    if (!VALID_PERIODS.has(period)) {
      span.setAttribute("error.kind", "invalid_period");
      return c.json({ error: "period must be 1mo, 3mo, 6mo, or 1y" }, 400);
    }

    span.setAttributes({ symbol, period });

    const started = performance.now();
    const result = await getHistoricalClosesWithProvider(symbol, period);
    const latencyMs = Math.round(performance.now() - started);
    span.setAttributes({
      latency_ms: latencyMs,
      history_hit: !!result?.value && result.value.length > 0,
      points: result?.value?.length ?? 0,
    });

    if (!result?.value || result.value.length === 0) {
      return c.json({ error: "history unavailable" }, 502);
    }

    c.header("Cache-Control", "public, max-age=60");
    return c.json({
      ticker: symbol,
      period,
      points: result.value,
      sources: [marketDataSource(result.provider)],
    });
  });
});

export default quoteHistory;
