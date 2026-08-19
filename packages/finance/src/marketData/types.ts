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

export type AggregatePage = {
  points: AggregateBar[];
  nextCursor?: string;
  requestId?: string;
};

export type AggregateQuery = {
  symbol: string;
  from: string;
  to: string;
  multiplier: number;
  timespan: "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";
  adjusted?: boolean;
  assetClass?: "stocks" | "options";
  cursor?: string;
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

/** Normalized response from Massive's financial ratios endpoint. */
export type FinancialRatios = {
  ticker: string;
  cik?: string;
  date?: string;
  price?: number;
  averageVolume?: number;
  marketCap?: number;
  earningsPerShare?: number;
  priceToEarnings?: number;
  priceToBook?: number;
  priceToSales?: number;
  priceToCashFlow?: number;
  priceToFreeCashFlow?: number;
  dividendYield?: number;
  returnOnAssets?: number;
  returnOnEquity?: number;
  debtToEquity?: number;
  current?: number;
  quick?: number;
  cash?: number;
  evToSales?: number;
  evToEbitda?: number;
  enterpriseValue?: number;
  freeCashFlow?: number;
};

export type FinancialRatio = FinancialRatios;

export type FinancialRatiosQuery = {
  ticker?: string;
  cik?: string;
  price?: number;
  averageVolume?: number;
  marketCap?: number;
  earningsPerShare?: number;
  priceToEarnings?: number;
  priceToBook?: number;
  priceToSales?: number;
  priceToCashFlow?: number;
  priceToFreeCashFlow?: number;
  dividendYield?: number;
  returnOnAssets?: number;
  returnOnEquity?: number;
  debtToEquity?: number;
  current?: number;
  quick?: number;
  cash?: number;
  evToSales?: number;
  evToEbitda?: number;
  enterpriseValue?: number;
  freeCashFlow?: number;
  limit?: number;
  sort?: string;
  cursor?: string;
};

export type OptionSnapshotQuery =
  | { underlyingTicker: string; optionTicker: string }
  | { underlyingTicker: string; ticker: string };

export type OptionAggregateQuery = Omit<AggregateQuery, "symbol" | "assetClass"> &
  ({ optionTicker: string } | { ticker: string });

export type CorporateEvent = {
  id?: string;
  ticker: string;
  type: string;
  date?: string;
  status?: string;
  description?: string;
  sourceUrl?: string;
  raw?: Record<string, unknown>;
  provider?: "massive" | "tmx";
  companyName?: string;
  isin?: string;
  tradingVenue?: string;
  tmxRecordId?: string;
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
  nextCursor?: string;
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
  getAggregatesPage(query: AggregateQuery): Promise<AggregatePage>;
  getOptionsChain(query: OptionsChainQuery): Promise<ProviderPage<OptionSnapshot>>;
  getOptionContracts(query: OptionContractQuery): Promise<ProviderPage<OptionContract>>;
  getOptionContract(ticker: string): Promise<OptionContract | null>;
  getFinancialRatios?: (query: FinancialRatiosQuery) => Promise<ProviderPage<FinancialRatios>>;
  getOptionSnapshot?: (query: OptionSnapshotQuery) => Promise<OptionSnapshot | null>;
  getOptionAggregates?: (query: OptionAggregateQuery) => Promise<AggregateBar[]>;
  getOptionAggregatesPage?: (query: OptionAggregateQuery) => Promise<AggregatePage>;
  getCorporateEvents(query: {
    ticker?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<CorporateEvent[]>;
  getTmxCorporateEvents(query: {
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
