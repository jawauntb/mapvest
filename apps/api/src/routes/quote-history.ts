import {
  DEFAULT_PERIOD_FOR_INTERVAL,
  VALID_HISTORY_PERIODS,
  clampPeriodForInterval,
  getHistoricalClosesWithProvider,
  normalizeHistoryInterval,
  type HistoryPeriod,
} from "@mapvest/finance";
import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { marketDataSource } from "../lib/marketDataSource.js";

const quoteHistory = new Hono();

/**
 * GET /v1/quote-history?symbol=AAPL&period=1y&interval=1d
 *
 * Closes at 15m / 1d / 1w. The last point is the live Massive snapshot when
 * the Stocks plan is entitled, so the chart shows the current print rather
 * than waiting for the bar to close.
 */
quoteHistory.get("/", async (c) => {
  return safeExecuteWithSpan("http.quote_history", async (span) => {
    const symbol = (c.req.query("symbol") ?? "").trim().toUpperCase();
    if (!symbol) {
      span.setAttribute("error.kind", "missing_symbol");
      return c.json({ error: "symbol required" }, 400);
    }

    let interval;
    try {
      interval = normalizeHistoryInterval(c.req.query("interval"));
    } catch {
      span.setAttribute("error.kind", "invalid_interval");
      return c.json({ error: "interval must be 15m, 1d, or 1w" }, 400);
    }

    const rawPeriod = (c.req.query("period") ?? "").trim();
    const period = (rawPeriod || DEFAULT_PERIOD_FOR_INTERVAL[interval]) as HistoryPeriod;
    if (!VALID_HISTORY_PERIODS.has(period)) {
      span.setAttribute("error.kind", "invalid_period");
      return c.json({ error: "period must be 5d, 1mo, 3mo, 6mo, 1y, or 2y" }, 400);
    }
    const lookback = clampPeriodForInterval(period, interval);

    span.setAttributes({ symbol, period: lookback, interval });

    const started = performance.now();
    const result = await getHistoricalClosesWithProvider(symbol, lookback, interval);
    const latencyMs = Math.round(performance.now() - started);
    span.setAttributes({
      latency_ms: latencyMs,
      history_hit: !!result?.value && result.value.length > 0,
      points: result?.value?.length ?? 0,
    });

    if (!result?.value || result.value.length === 0) {
      return c.json({ error: "history unavailable" }, 502);
    }

    c.header("Cache-Control", interval === "15m" ? "public, max-age=15" : "public, max-age=60");
    return c.json({
      ticker: symbol,
      period: lookback,
      interval,
      points: result.value,
      sources: [marketDataSource(result.provider)],
    });
  });
});

export default quoteHistory;
