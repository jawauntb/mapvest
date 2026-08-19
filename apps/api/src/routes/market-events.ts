import { MarketDataProviderError, getCorporateEvents } from "@mapvest/finance";
import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { marketDataSource } from "../lib/marketDataSource.js";

const events = new Hono();

events.get("/", async (c) => {
  return safeExecuteWithSpan("http.market_events", async (span) => {
    const ticker = c.req.query("ticker")?.trim().toUpperCase();
    const limitRaw = Number(c.req.query("limit") ?? "100");
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(500, Math.floor(limitRaw)))
      : 100;
    span.setAttributes({ ticker: ticker ?? "", limit });
    try {
      const result = await getCorporateEvents({
        ticker,
        from: c.req.query("from"),
        to: c.req.query("to"),
        limit,
      });
      return c.json({ ticker, events: result, sources: [marketDataSource()] });
    } catch (error) {
      if (error instanceof MarketDataProviderError && error.status === 429) {
        return c.json({ error: "market data rate limited" }, 429);
      }
      return c.json({ error: "market events unavailable" }, 502);
    }
  });
});

export default events;
