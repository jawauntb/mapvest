import {
  MarketDataProviderError,
  getAggregates,
  getMarketDataCapabilities,
} from "@mapvest/finance";
import type { AggregateQuery } from "@mapvest/finance";
import { type Context, Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { marketDataSource } from "../lib/marketDataSource.js";

const marketData = new Hono();

function validDate(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

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
marketData.get("/aggregates", async (c) => {
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
    const from = validDate(c.req.query("from")) ?? defaultDate(30);
    const to = validDate(c.req.query("to")) ?? defaultDate(0);
    const assetClass = c.req.query("assetClass") === "options" ? "options" : "stocks";
    span.setAttributes({ symbol, timespan, multiplier, from, to, asset_class: assetClass });
    try {
      const points = await getAggregates({
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
        points,
        sources: [marketDataSource()],
      });
    } catch (error) {
      return providerError(c, error);
    }
  });
});

export default marketData;
