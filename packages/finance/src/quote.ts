import { getQuote as routedGetQuote } from "./marketData/router.js";
export {
  parseYahooChart,
  YAHOO_QUOTE_DISCLAIMER as QUOTE_DISCLAIMER,
  clearYahooCaches as _clearQuoteCache,
} from "./marketData/yahoo.js";
export type { YahooChartResponse } from "./marketData/yahoo.js";

export type Quote = {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  currency: string;
  ts: string;
  disclaimer: string;
  name?: string;
  provider?: "massive" | "yahoo";
  freshness?: "real-time" | "delayed" | "end-of-day" | "unknown";
};

export async function getQuote(symbol: string): Promise<Quote | null> {
  try {
    return await routedGetQuote(symbol);
  } catch {
    // Preserve the legacy best-effort quote contract: callers receive null
    // and existing HTTP routes continue to return 502 rather than 500.
    return null;
  }
}
