import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { type Period, VALID_PERIODS, getHistoricalCloses } from "../lib/yahooHistory.js";

const quoteHistory = new Hono();

/**
 * GET /v1/quote-history?symbol=AAPL&period=1mo
 *
 * Daily Yahoo closes for the native Overview price chart. Never invents
 * prices — 502 when Yahoo has no usable series.
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
    const points = await getHistoricalCloses(symbol, period);
    const latencyMs = Math.round(performance.now() - started);
    span.setAttributes({
      latency_ms: latencyMs,
      history_hit: !!points && points.length > 0,
      points: points?.length ?? 0,
    });

    if (!points || points.length === 0) {
      return c.json({ error: "history unavailable" }, 502);
    }

    const fetchedAt = new Date().toISOString();
    c.header("Cache-Control", "public, max-age=60");
    return c.json({
      ticker: symbol,
      period,
      points,
      sources: [
        {
          provider: "yahoo",
          url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
          fetchedAt,
          confidence: "high",
        },
      ],
    });
  });
});

export default quoteHistory;
