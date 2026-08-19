import {
  MarketDataProviderError,
  getAggregatesPage,
  getMarketDataCapabilities,
} from "@mapvest/finance";
import type { AggregateQuery } from "@mapvest/finance";
import { type Context, Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { marketDataSource } from "../lib/marketDataSource.js";
import { dateRangeDays, parseMarketDate } from "../lib/marketDataValidation.js";
import { marketDataRateLimit } from "../middleware/marketDataRateLimit.js";

const marketData = new Hono();

function defaultDate(daysAgo: number): string {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1_000);
  return date.toISOString().slice(0, 10);
}

function providerError(c: Context, error: unknown) {
  if (error instanceof MarketDataProviderError) {
    const status = error.status === 429 ? 429 : error.status === 503 ? 503 : 502;
    return c.json(
      { error: status === 429 ? "market data rate limited" : "market data unavailable" },
      status,
    );
  }
  return c.json({ error: "market data unavailable" }, 502);
}

marketData.get("/capabilities", (c) => c.json(getMarketDataCapabilities()));

/** Additive endpoint for Massive stock/option OHLCV aggregates. */
marketData.get("/aggregates", marketDataRateLimit, async (c) => {
  return safeExecuteWithSpan("http.market_data_aggregates", async (span) => {
    const symbol = (c.req.query("symbol") ?? "").trim().toUpperCase();
    if (!symbol) return c.json({ error: "symbol required" }, 400);
    const timespan = (c.req.query("timespan") ?? "day").trim().toLowerCase();
    const validTimespans = new Set(["minute", "hour", "day", "week", "month", "quarter", "year"]);
    if (!validTimespans.has(timespan)) return c.json({ error: "invalid timespan" }, 400);
    const multiplier = Number(c.req.query("multiplier") ?? "1");
    if (!Number.isInteger(multiplier) || multiplier < 1 || multiplier > 1_000) {
      return c.json({ error: "multiplier must be a positive integer" }, 400);
    }
    const rawFrom = c.req.query("from");
    const rawTo = c.req.query("to");
    const fromDate = rawFrom ? parseMarketDate(rawFrom) : parseMarketDate(defaultDate(30));
    const toDate = rawTo ? parseMarketDate(rawTo) : parseMarketDate(defaultDate(0));
    if ((rawFrom && !fromDate) || (rawTo && !toDate)) {
      return c.json({ error: "from and to must be valid dates" }, 400);
    }
    if (!fromDate || !toDate || fromDate > toDate) {
      return c.json({ error: "from must be on or before to" }, 400);
    }
    const barsPerDay =
      timespan === "minute"
        ? 1_440
        : timespan === "hour"
          ? 24
          : timespan === "week"
            ? 1 / 7
            : timespan === "month"
              ? 1 / 30
              : timespan === "quarter"
                ? 1 / 90
                : timespan === "year"
                  ? 1 / 365
                  : 1;
    const estimatedBars = Math.ceil((dateRangeDays(fromDate, toDate) * barsPerDay) / multiplier);
    if (estimatedBars > 50_000) {
      return c.json({ error: "aggregate range too large" }, 400);
    }
    const from = fromDate.toISOString().slice(0, 10);
    const to = toDate.toISOString().slice(0, 10);
    const assetClass = c.req.query("assetClass") === "options" ? "options" : "stocks";
    span.setAttributes({ symbol, timespan, multiplier, from, to, asset_class: assetClass });
    try {
      const page = await getAggregatesPage({
        symbol,
        from,
        to,
        multiplier,
        timespan: timespan as AggregateQuery["timespan"],
        adjusted: c.req.query("adjusted") !== "false",
        assetClass,
      });
      return c.json({
        symbol,
        from,
        to,
        multiplier,
        timespan,
        points: page.points,
        nextCursor: page.nextCursor,
        requestId: page.requestId,
        sources: [marketDataSource()],
      });
    } catch (error) {
      return providerError(c, error);
    }
  });
});

export default marketData;
