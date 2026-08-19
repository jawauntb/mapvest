import {
  MarketDataProviderError,
  getCorporateEvents,
  getTmxCorporateEvents,
} from "@mapvest/finance";
import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { marketDataSource } from "../lib/marketDataSource.js";
import { dateRangeDays, parseMarketDate } from "../lib/marketDataValidation.js";
import { marketDataRateLimit } from "../middleware/marketDataRateLimit.js";

const events = new Hono();

events.get("/", marketDataRateLimit, async (c) => {
  return safeExecuteWithSpan("http.market_events", async (span) => {
    const ticker = c.req.query("ticker")?.trim().toUpperCase();
    const limitRaw = Number(c.req.query("limit") ?? "100");
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(500, Math.floor(limitRaw)))
      : 100;
    const rawFrom = c.req.query("from");
    const rawTo = c.req.query("to");
    const fromDate = parseMarketDate(rawFrom);
    const toDate = parseMarketDate(rawTo);
    if ((rawFrom && !fromDate) || (rawTo && !toDate)) {
      return c.json({ error: "from and to must be valid dates" }, 400);
    }
    if (fromDate && toDate && fromDate > toDate) {
      return c.json({ error: "from must be on or before to" }, 400);
    }
    if (!ticker && (!fromDate || !toDate)) {
      return c.json({ error: "ticker or bounded date range required" }, 400);
    }
    if (fromDate && toDate && dateRangeDays(fromDate, toDate) > 366) {
      return c.json({ error: "event date range too large" }, 400);
    }
    span.setAttributes({ ticker: ticker ?? "", limit });
    try {
      const result = await getCorporateEvents({
        ticker,
        from: c.req.query("from"),
        to: c.req.query("to"),
        limit,
      });
      let tmxAvailable = false;
      let tmxEvents: Awaited<ReturnType<typeof getTmxCorporateEvents>> = [];
      if (process.env.MASSIVE_CORPORATE_EVENTS_ENABLED === "1") {
        try {
          tmxEvents = await getTmxCorporateEvents({
            ticker,
            from: c.req.query("from"),
            to: c.req.query("to"),
            limit,
          });
          tmxAvailable = true;
        } catch {
          // TMX is a separately subscribed partner dataset. Its absence must
          // not remove the existing splits/dividends response.
        }
      }
      const events = [...result, ...tmxEvents]
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
        .slice(0, limit);
      return c.json({ ticker, events, tmxAvailable, sources: [marketDataSource()] });
    } catch (error) {
      if (error instanceof MarketDataProviderError && error.status === 429) {
        return c.json({ error: "market data rate limited" }, 429);
      }
      if (error instanceof MarketDataProviderError && error.status === 503) {
        return c.json({ error: "market data provider not configured" }, 503);
      }
      return c.json({ error: "market events unavailable" }, 502);
    }
  });
});

export default events;
