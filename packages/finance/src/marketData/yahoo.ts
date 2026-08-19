import type { Quote } from "../quote.js";
import type {
  AggregateBar,
  AggregatePage,
  AggregateQuery,
  CorporateEvent,
  HistoryPoint,
  MarketDataCapabilities,
  OptionContract,
  OptionContractQuery,
  OptionSnapshot,
  OptionsChainQuery,
  ProviderPage,
} from "./types.js";
import { MarketDataProviderError } from "./types.js";

const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v7/finance/chart";
const HISTORY_TTL_MS = 30 * 60 * 1000;
const QUOTE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;
const quoteCache = new Map<string, { at: number; value: Quote | null }>();
const historyCache = new Map<string, { at: number; value: HistoryPoint[] | null }>();

export const YAHOO_QUOTE_DISCLAIMER = "delayed by 15 min, source: Yahoo Finance";

type YahooChartMeta = {
  symbol?: string;
  currency?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketTime?: number;
  shortName?: string;
  longName?: string;
};
export type YahooChartResponse = {
  chart?: { result?: Array<{ meta?: YahooChartMeta } | null> | null; error?: unknown };
};

function numberOrNull(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

export function parseYahooChart(sym: string, json: YahooChartResponse): Quote | null {
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const price = numberOrNull(meta.regularMarketPrice);
  const prev = numberOrNull(meta.chartPreviousClose) ?? numberOrNull(meta.previousClose);
  if (price === null || prev === null) return null;
  const change = price - prev;
  const ts = meta.regularMarketTime
    ? new Date(meta.regularMarketTime * 1_000).toISOString()
    : new Date().toISOString();
  const name = [meta.shortName, meta.longName]
    .find((n) => typeof n === "string" && n.trim().length > 0)
    ?.trim();
  return {
    symbol: meta.symbol ?? sym,
    price,
    change,
    changePct: prev !== 0 ? (change / prev) * 100 : 0,
    currency: meta.currency ?? "USD",
    ts,
    disclaimer: YAHOO_QUOTE_DISCLAIMER,
    ...(name ? { name } : {}),
    provider: "yahoo",
    freshness: "delayed",
  };
}

async function fetchJson(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "mapvest/0.1 (+https://mapvest.app)" },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function getYahooQuote(symbol: string): Promise<Quote | null> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return null;
  const now = Date.now();
  const cached = quoteCache.get(sym);
  if (cached && now - cached.at < QUOTE_TTL_MS) return cached.value;
  try {
    const response = await fetchJson(
      `${YAHOO_CHART_BASE}/${encodeURIComponent(sym)}?interval=1d&range=1d`,
    );
    const value = response.ok
      ? parseYahooChart(sym, (await response.json()) as YahooChartResponse)
      : null;
    quoteCache.set(sym, { at: now, value });
    return value;
  } catch {
    quoteCache.set(sym, { at: now, value: null });
    return null;
  }
}

export function clearYahooCaches(): void {
  quoteCache.clear();
  historyCache.clear();
}

type YahooHistoryResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: Array<number | null> }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    } | null> | null;
  };
};

export async function getYahooHistoricalCloses(
  symbol: string,
  period: "1mo" | "3mo" | "6mo" | "1y",
): Promise<HistoryPoint[] | null> {
  const sym = symbol.trim().toUpperCase();
  const key = `${sym}::${period}`;
  const now = Date.now();
  const cached = historyCache.get(key);
  if (cached && now - cached.at < HISTORY_TTL_MS) return cached.value;
  try {
    const response = await fetchJson(
      `${YAHOO_CHART_BASE}/${encodeURIComponent(sym)}?interval=1d&range=${period}`,
    );
    if (!response.ok) throw new Error(`Yahoo history ${response.status}`);
    const result = ((await response.json()) as YahooHistoryResponse)?.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const closes =
      result?.indicators?.adjclose?.[0]?.adjclose ?? result?.indicators?.quote?.[0]?.close;
    const points =
      timestamps && closes
        ? timestamps.flatMap((ts, index) => {
            const close = closes[index];
            return typeof ts === "number" &&
              typeof close === "number" &&
              Number.isFinite(close) &&
              close > 0
              ? [{ ts, close }]
              : [];
          })
        : [];
    const value = points.length >= 2 ? points : null;
    historyCache.set(key, { at: now, value });
    return value;
  } catch {
    historyCache.set(key, { at: now, value: null });
    return null;
  }
}

const unsupported = (operation: string): never => {
  throw new MarketDataProviderError(`Yahoo fallback does not support ${operation}`, {
    provider: "yahoo",
    status: 501,
    code: "unsupported",
  });
};

export const yahooCapabilities = (): MarketDataCapabilities => ({
  provider: "yahoo",
  configured: true,
  freshness: "delayed",
  subscription: {},
  datasets: {
    quotes: {
      supported: true,
      access: "fallback",
      note: "Legacy Yahoo chart fallback; approximately 15 minutes delayed.",
    },
    history: { supported: true, access: "fallback", note: "Legacy adjusted daily chart fallback." },
    aggregates: { supported: false, access: "unconfigured" },
    optionChain: { supported: false, access: "unconfigured" },
    optionContracts: { supported: false, access: "unconfigured" },
    corporateActions: { supported: false, access: "unconfigured" },
    corporateEvents: { supported: false, access: "unconfigured" },
    websockets: { supported: false, access: "unconfigured" },
  },
});

export const yahooProvider = {
  name: "yahoo" as const,
  capabilities: yahooCapabilities,
  getQuote: getYahooQuote,
  getHistoricalCloses: getYahooHistoricalCloses,
  getAggregates: async (_query: AggregateQuery): Promise<AggregateBar[]> =>
    unsupported("aggregates"),
  getAggregatesPage: async (_query: AggregateQuery): Promise<AggregatePage> =>
    unsupported("aggregates"),
  getOptionsChain: async (_query: OptionsChainQuery): Promise<ProviderPage<OptionSnapshot>> =>
    unsupported("options chains"),
  getOptionContracts: async (_query: OptionContractQuery): Promise<ProviderPage<OptionContract>> =>
    unsupported("option contracts"),
  getOptionContract: async (_ticker: string): Promise<OptionContract | null> =>
    unsupported("option contracts"),
  getCorporateEvents: async (_query: {
    ticker?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<CorporateEvent[]> => unsupported("corporate events"),
  getTmxCorporateEvents: async (_query: {
    ticker?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<CorporateEvent[]> => unsupported("TMX corporate events"),
};
