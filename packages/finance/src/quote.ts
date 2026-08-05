/**
 * Realtime-ish quote enrichment via Yahoo Finance's public v7 chart endpoint.
 *
 * This module is intentionally defensive: it never throws, it caches results
 * in-process for a short window, and it uses a hard 3-second timeout so that
 * a slow upstream can never wedge the identify path. Callers should treat a
 * null return as "no quote available, carry on".
 *
 * Data source disclaimer (Yahoo TOS): quotes are delayed by 15 minutes.
 */

export type Quote = {
  symbol: string;
  price: number;
  /** Absolute change vs prior close (may be negative). */
  change: number;
  /** Percent change vs prior close, expressed as a percent (e.g. 1.23 = +1.23%). */
  changePct: number;
  currency: string;
  /** ISO-8601 timestamp of the market data point. */
  ts: string;
  /** Verbatim disclaimer per Yahoo TOS. */
  disclaimer: string;
};

export const QUOTE_DISCLAIMER = "delayed by 15 min, source: Yahoo Finance";

const QUOTE_TTL_MS = 30_000;
const QUOTE_FETCH_TIMEOUT_MS = 3_000;
const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v7/finance/chart";

type CacheEntry = { at: number; value: Quote | null };
const cache = new Map<string, CacheEntry>();

/** Yahoo chart-endpoint response shape (only the bits we consume). */
type YahooChartMeta = {
  symbol?: string;
  currency?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketTime?: number;
};
type YahooChartResponse = {
  chart?: {
    result?: Array<{ meta?: YahooChartMeta } | null> | null;
    error?: unknown;
  };
};

/** Exposed for tests. Callers should have no reason to reach in. */
export function _clearQuoteCache(): void {
  cache.clear();
}

/**
 * Fetch a delayed quote for `symbol`. Returns null on any failure — the
 * function is best-effort and must never throw.
 *
 * Results are cached in-process for 30 seconds keyed by upper-cased symbol.
 * Nulls are cached too, so a rate-limit or garbage symbol won't hammer Yahoo
 * on repeated calls.
 */
export async function getQuote(symbol: string): Promise<Quote | null> {
  const sym = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
  if (!sym) return null;

  const now = Date.now();
  const cached = cache.get(sym);
  if (cached && now - cached.at < QUOTE_TTL_MS) {
    return cached.value;
  }

  const value = await fetchQuoteFromYahoo(sym);
  cache.set(sym, { at: now, value });
  return value;
}

async function fetchQuoteFromYahoo(sym: string): Promise<Quote | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), QUOTE_FETCH_TIMEOUT_MS);
  try {
    const url = `${YAHOO_CHART_BASE}/${encodeURIComponent(sym)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      signal: ctl.signal,
      // Yahoo's public endpoint is friendlier when a UA is present.
      headers: { "user-agent": "mapvest/0.1 (+https://mapvest.app)" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as YahooChartResponse;
    return parseYahooChart(sym, json);
  } catch {
    // Timeouts, DNS, JSON errors — all treated the same: no quote.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Exported for unit testing the parser without the network. */
export function parseYahooChart(sym: string, json: YahooChartResponse): Quote | null {
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const price = numberOrNull(meta.regularMarketPrice);
  const prev = numberOrNull(meta.chartPreviousClose) ?? numberOrNull(meta.previousClose);
  if (price === null || prev === null) return null;

  const change = price - prev;
  // Guard against prev === 0 producing Infinity.
  const changePct = prev !== 0 ? (change / prev) * 100 : 0;

  const tsSec = numberOrNull(meta.regularMarketTime);
  const ts = tsSec !== null ? new Date(tsSec * 1000).toISOString() : new Date().toISOString();

  return {
    symbol: meta.symbol ?? sym,
    price,
    change,
    changePct,
    currency: meta.currency ?? "USD",
    ts,
    disclaimer: QUOTE_DISCLAIMER,
  };
}

function numberOrNull(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}
