import { FinancialRatiosRequest } from "@mapvest/core";
import { MarketDataProviderError, getFinancialRatios, getPrimaryProvider } from "@mapvest/finance";
import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { marketDataSource } from "../lib/marketDataSource.js";
import { marketDataRateLimit } from "../middleware/marketDataRateLimit.js";

const financials = new Hono();

type RatioRow = Record<string, unknown>;

function numberValue(row: RatioRow, camel: string, snake: string): number | undefined {
  const value = row[camel] ?? row[snake];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(row: RatioRow, camel: string, snake: string): string | undefined {
  const value = row[camel] ?? row[snake];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeRatio(row: RatioRow, requestedTicker: string) {
  return {
    ticker: stringValue(row, "ticker", "ticker") ?? requestedTicker,
    date: stringValue(row, "date", "date"),
    averageVolume: numberValue(row, "averageVolume", "average_volume"),
    cash: numberValue(row, "cash", "cash"),
    cik: stringValue(row, "cik", "cik"),
    current: numberValue(row, "current", "current"),
    debtToEquity: numberValue(row, "debtToEquity", "debt_to_equity"),
    dividendYield: numberValue(row, "dividendYield", "dividend_yield"),
    earningsPerShare: numberValue(row, "earningsPerShare", "earnings_per_share"),
    enterpriseValue: numberValue(row, "enterpriseValue", "enterprise_value"),
    evToEbitda: numberValue(row, "evToEbitda", "ev_to_ebitda"),
    evToSales: numberValue(row, "evToSales", "ev_to_sales"),
    freeCashFlow: numberValue(row, "freeCashFlow", "free_cash_flow"),
    marketCap: numberValue(row, "marketCap", "market_cap"),
    price: numberValue(row, "price", "price"),
    priceToBook: numberValue(row, "priceToBook", "price_to_book"),
    priceToCashFlow: numberValue(row, "priceToCashFlow", "price_to_cash_flow"),
    priceToEarnings: numberValue(row, "priceToEarnings", "price_to_earnings"),
    priceToFreeCashFlow: numberValue(row, "priceToFreeCashFlow", "price_to_free_cash_flow"),
    priceToSales: numberValue(row, "priceToSales", "price_to_sales"),
    quick: numberValue(row, "quick", "quick"),
    returnOnAssets: numberValue(row, "returnOnAssets", "return_on_assets"),
    returnOnEquity: numberValue(row, "returnOnEquity", "return_on_equity"),
  };
}

function providerError(error: unknown) {
  if (error instanceof MarketDataProviderError) {
    if (error.status === 429) return { body: { error: "market data rate limited" }, status: 429 };
    if (error.status === 503) {
      return { body: { error: "financial ratios unavailable" }, status: 503 };
    }
    if (error.status === 501) {
      return { body: { error: "financial ratios unsupported" }, status: 501 };
    }
  }
  return { body: { error: "financial ratios unavailable" }, status: 502 };
}

/** GET /v1/financials/ratios?ticker=AAPL&limit=1&cursor=<opaque> */
financials.get("/ratios", marketDataRateLimit, async (c) => {
  return safeExecuteWithSpan("http.financials_ratios", async (span) => {
    const rawTicker = (c.req.query("ticker") ?? "").trim().toUpperCase();
    if (!rawTicker) return c.json({ error: "ticker required" }, 400);

    const parsed = FinancialRatiosRequest.safeParse({
      ticker: rawTicker,
      limit: c.req.query("limit"),
      cursor: c.req.query("cursor"),
    });
    if (!parsed.success) return c.json({ error: "invalid financial ratios query" }, 400);

    const { ticker, limit, cursor } = parsed.data;
    span.setAttributes({ ticker, limit, has_cursor: Boolean(cursor) });

    try {
      const provider = getPrimaryProvider();
      const page = await getFinancialRatios({ ticker, limit });
      return c.json({
        ticker,
        ratios: page.results.map((row) => normalizeRatio(row as RatioRow, ticker)),
        nextCursor: page.nextCursor,
        requestId: page.requestId,
        sources: [marketDataSource(provider.name)],
      });
    } catch (error) {
      const mapped = providerError(error);
      return c.json(mapped.body, mapped.status as 429 | 501 | 502 | 503);
    }
  });
});

export default financials;
