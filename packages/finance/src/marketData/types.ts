import type { Quote } from "../quote.js";

export type MarketDataProviderName = "massive" | "yahoo";
export type MarketDataFreshness = "real-time" | "delayed" | "end-of-day" | "unknown";

export type HistoryPoint = { ts: number; close: number };

export type AggregateBar = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  vwap?: number;
  transactions?: number;
};

export type AggregateQuery = {
  symbol: string;
  from: string;
  to: string;
  multiplier: number;
  timespan: "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";
  adjusted?: boolean;
  assetClass?: "stocks" | "options";
};

export type OptionContract = {
  ticker: string;
  underlyingTicker?: string;
  contractType?: "call" | "put" | "other";
  expirationDate?: string;
  strikePrice?: number;
  exerciseStyle?: "american" | "bermudan" | "european";
  sharesPerContract?: number;
  primaryExchange?: string;
  cfi?: string;
};

export type OptionQuote = {
  bid?: number;
  ask?: number;
  bidSize?: number;
  askSize?: number;
  ts?: number;
};

export type OptionTrade = {
  price?: number;
  size?: number;
  ts?: number;
};

export type OptionSnapshot = OptionContract & {
  breakEvenPrice?: number;
  impliedVolatility?: number;
  openInterest?: number;
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number };
  quote?: OptionQuote;
  trade?: OptionTrade;
  day?: { open?: number; high?: number; low?: number; close?: number; volume?: number };
};

export type CorporateEvent = {
  id?: string;
  ticker: string;
  type: string;
  date?: string;
  status?: string;
  description?: string;
  sourceUrl?: string;
  raw?: Record<string, unknown>;
};

export type MarketDataCapabilities = {
  provider: MarketDataProviderName;
  configured: boolean;
  freshness: MarketDataFreshness;
  datasets: Record<
    string,
    { supported: boolean; access: "primary" | "fallback" | "unconfigured"; note?: string }
  >;
  subscription: { stocks?: string; options?: string; events?: string };
};

export type OptionContractQuery = {
  underlyingTicker?: string;
  ticker?: string;
  contractType?: "call" | "put";
  expirationDate?: string;
  asOf?: string;
  strikePrice?: number;
  expired?: boolean;
  limit?: number;
  cursor?: string;
};

export type OptionsChainQuery = OptionContractQuery & {
  underlyingTicker: string;
};

export type ProviderPage<T> = {
  results: T[];
  nextUrl?: string;
  requestId?: string;
};

export type MarketDataProvider = {
  name: MarketDataProviderName;
  capabilities(): MarketDataCapabilities;
  getQuote(symbol: string): Promise<Quote | null>;
  getHistoricalCloses(
    symbol: string,
    period: "1mo" | "3mo" | "6mo" | "1y",
  ): Promise<HistoryPoint[] | null>;
  getAggregates(query: AggregateQuery): Promise<AggregateBar[]>;
  getOptionsChain(query: OptionsChainQuery): Promise<ProviderPage<OptionSnapshot>>;
  getOptionContracts(query: OptionContractQuery): Promise<ProviderPage<OptionContract>>;
  getOptionContract(ticker: string): Promise<OptionContract | null>;
  getCorporateEvents(query: {
    ticker?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<CorporateEvent[]>;
};

export class MarketDataProviderError extends Error {
  readonly provider: MarketDataProviderName;
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(
    message: string,
    options: {
      provider: MarketDataProviderName;
      status: number;
      code: string;
      requestId?: string;
    },
  ) {
    super(message);
    this.name = "MarketDataProviderError";
    this.provider = options.provider;
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
  }
}
