import type { Quote } from "../quote.js";
import {
  type AggregateBar,
  type AggregatePage,
  type AggregateQuery,
  type CorporateEvent,
  type HistoryPoint,
  type MarketDataCapabilities,
  MarketDataProviderError,
  type OptionContract,
  type OptionContractQuery,
  type OptionSnapshot,
  type OptionsChainQuery,
  type ProviderPage,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.massive.com";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRIES = 2;

export function massiveBaseUrl(): string {
  const raw = process.env.MASSIVE_BASE_URL?.trim() || DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MarketDataProviderError("Invalid Massive base URL", {
      provider: "massive",
      status: 503,
      code: "invalid_configuration",
    });
  }
  const testOverride =
    process.env.NODE_ENV === "test" && process.env.MASSIVE_ALLOW_TEST_BASE_URL === "1";
  if (
    (!testOverride && url.protocol !== "https:") ||
    (!testOverride && url.hostname !== "api.massive.com")
  ) {
    throw new MarketDataProviderError("Massive base URL is not allowed", {
      provider: "massive",
      status: 503,
      code: "invalid_configuration",
    });
  }
  return url.toString().replace(/\/$/, "");
}

type MassiveEnvelope<T> = {
  results?: T[] | T;
  next_url?: string;
  request_id?: string;
  status?: string;
  error?: string;
  message?: string;
};

type MassiveTickerSnapshot = {
  ticker?: {
    day?: { c?: number; o?: number; h?: number; l?: number; v?: number; vw?: number; t?: number };
    prevDay?: { c?: number };
    lastTrade?: { p?: number; t?: number };
    lastQuote?: { P?: number; p?: number; t?: number };
    updated?: number;
    name?: string;
    currencyName?: string;
  };
};

type MassiveAggregate = {
  t?: number;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
  vw?: number;
  n?: number;
};
type MassiveContract = {
  ticker?: string;
  underlying_ticker?: string;
  contract_type?: "call" | "put" | "other";
  expiration_date?: string;
  strike_price?: number;
  exercise_style?: "american" | "bermudan" | "european";
  shares_per_contract?: number;
  primary_exchange?: string;
  cfi?: string;
};
type MassiveTmxEvent = {
  company_name?: string;
  date?: string;
  isin?: string;
  name?: string;
  status?: string;
  ticker?: string;
  tmx_record_id?: string;
  trading_venue?: string;
  type?: string;
  url?: string;
};
type MassiveOptionSnapshot = MassiveContract & {
  details?: MassiveContract;
  break_even_price?: number;
  implied_volatility?: number;
  open_interest?: number;
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number };
  last_quote?: {
    bid?: number;
    ask?: number;
    bid_size?: number;
    ask_size?: number;
    last_updated?: number;
  };
  last_trade?: { price?: number; size?: number; sip_timestamp?: number };
  day?: { open?: number; high?: number; low?: number; close?: number; volume?: number };
};

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function freshness(): MarketDataCapabilities["freshness"] {
  const value = process.env.MASSIVE_MARKET_DATA_FRESHNESS?.trim().toLowerCase();
  if (value === "real-time" || value === "realtime") return "real-time";
  if (value === "delayed" || value === "15-minute" || value === "15m") return "delayed";
  if (value === "end-of-day" || value === "eod") return "end-of-day";
  return "unknown";
}

function isoFromTimestamp(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return new Date().toISOString();
  }
  const millis =
    value > 10_000_000_000_000 ? value / 1_000_000 : value > 10_000_000_000 ? value : value * 1_000;
  return new Date(millis).toISOString();
}

function unixSeconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  if (value > 1_000_000_000_000_000) return Math.floor(value / 1_000_000_000);
  if (value > 10_000_000_000) return Math.floor(value / 1_000);
  return Math.floor(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function dateRange(period: "1mo" | "3mo" | "6mo" | "1y"): { from: string; to: string } {
  const days = { "1mo": 45, "3mo": 110, "6mo": 220, "1y": 400 }[period];
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function cursorFromNextUrl(nextUrl: string | undefined): string | undefined {
  if (!nextUrl) return undefined;
  try {
    return new URL(nextUrl).searchParams.get("cursor") ?? undefined;
  } catch {
    return undefined;
  }
}

function mapContract(value: MassiveContract): OptionContract | null {
  if (!value.ticker) return null;
  return {
    ticker: value.ticker,
    underlyingTicker: value.underlying_ticker,
    contractType: value.contract_type,
    expirationDate: value.expiration_date,
    strikePrice: numberOrUndefined(value.strike_price),
    exerciseStyle: value.exercise_style,
    sharesPerContract: numberOrUndefined(value.shares_per_contract),
    primaryExchange: value.primary_exchange,
    cfi: value.cfi,
  };
}

function mapSnapshot(value: MassiveOptionSnapshot): OptionSnapshot | null {
  const contract = mapContract(value.details ?? value);
  if (!contract) return null;
  return {
    ...contract,
    breakEvenPrice: numberOrUndefined(value.break_even_price),
    impliedVolatility: numberOrUndefined(value.implied_volatility),
    openInterest: numberOrUndefined(value.open_interest),
    greeks: value.greeks,
    quote: value.last_quote
      ? {
          bid: numberOrUndefined(value.last_quote.bid),
          ask: numberOrUndefined(value.last_quote.ask),
          bidSize: numberOrUndefined(value.last_quote.bid_size),
          askSize: numberOrUndefined(value.last_quote.ask_size),
          ts: unixSeconds(value.last_quote.last_updated),
        }
      : undefined,
    trade: value.last_trade
      ? {
          price: numberOrUndefined(value.last_trade.price),
          size: numberOrUndefined(value.last_trade.size),
          ts: unixSeconds(value.last_trade.sip_timestamp),
        }
      : undefined,
    day: value.day,
  };
}

export class MassiveClient {
  readonly name = "massive" as const;

  get configured(): boolean {
    return Boolean(process.env.MASSIVE_API_KEY?.trim());
  }

  capabilities(): MarketDataCapabilities {
    const configured = this.configured;
    const access = configured ? "primary" : "unconfigured";
    return {
      provider: "massive",
      configured,
      freshness: freshness(),
      subscription: {
        stocks: process.env.MASSIVE_STOCKS_PLAN?.trim() || undefined,
        options: process.env.MASSIVE_OPTIONS_PLAN?.trim() || undefined,
        events: process.env.MASSIVE_EVENTS_PLAN?.trim() || undefined,
      },
      datasets: {
        quotes: {
          supported: true,
          access,
          note: "Snapshot endpoint; realtime availability follows the subscribed Stocks plan.",
        },
        trades: {
          supported: true,
          access,
          note: "Last trade and historical trade endpoints follow the subscribed Stocks/Options plan.",
        },
        aggregates: {
          supported: true,
          access,
          note: "Stock and option bars use Massive aggregate endpoints.",
        },
        optionChain: {
          supported: true,
          access,
          note: "Chain snapshots require an Options plan with chain access.",
        },
        optionContracts: {
          supported: true,
          access,
          note: "Contract reference data is available across Options plans.",
        },
        corporateActions: {
          supported: true,
          access,
          note: "Dividends and splits are available on Stocks plans.",
        },
        corporateEvents: {
          supported: process.env.MASSIVE_CORPORATE_EVENTS_ENABLED === "1",
          access: process.env.MASSIVE_CORPORATE_EVENTS_ENABLED === "1" ? access : "unconfigured",
          note: "TMX/Wall Street Horizon events are an optional partner dataset; enable only when subscribed.",
        },
        websockets: {
          supported: true,
          access,
          note: "Streaming requires a plan that includes the requested feed and connection limits apply.",
        },
      },
    };
  }

  private get apiKey(): string {
    const value = process.env.MASSIVE_API_KEY?.trim();
    if (!value) {
      throw new MarketDataProviderError("Massive API key is not configured", {
        provider: "massive",
        status: 503,
        code: "not_configured",
      });
    }
    return value;
  }

  private get baseUrl(): string {
    return massiveBaseUrl();
  }

  private async request<T>(
    pathOrUrl: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ): Promise<MassiveEnvelope<T>> {
    const retries = Math.min(4, Math.floor(envNumber("MASSIVE_MAX_RETRIES", DEFAULT_RETRIES)));
    const timeoutMs = Math.max(
      250,
      Math.floor(envNumber("MASSIVE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS)),
    );
    const target = pathOrUrl.startsWith("http")
      ? new URL(pathOrUrl)
      : new URL(`${this.baseUrl}${pathOrUrl}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && !target.searchParams.has(key))
        target.searchParams.set(key, String(value));
    }
    const url = target.toString();
    let lastStatus = 502;
    let lastRequestId: string | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: "application/json", Authorization: `Bearer ${this.apiKey}` },
        });
        const payload = (await response.json().catch(() => ({}))) as MassiveEnvelope<T>;
        lastStatus = response.status;
        lastRequestId = payload.request_id;
        const retryable =
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500;
        if (response.ok && payload.status !== "ERROR") return payload;
        if (!retryable || attempt >= retries) {
          throw new MarketDataProviderError(
            payload.message || payload.error || `Massive request failed (${response.status})`,
            {
              provider: "massive",
              status: response.status,
              code: response.status === 429 ? "rate_limited" : "upstream_error",
              requestId: payload.request_id,
            },
          );
        }
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay =
          Number.isFinite(retryAfter) && retryAfter >= 0
            ? retryAfter * 1_000
            : envNumber("MASSIVE_RETRY_DELAY_MS", 100) * 2 ** attempt + Math.random() * 25;
        await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 2_000)));
      } catch (error) {
        if (error instanceof MarketDataProviderError) throw error;
        if (attempt >= retries) {
          throw new MarketDataProviderError("Massive request failed", {
            provider: "massive",
            status: lastStatus,
            code: "network_error",
            requestId: lastRequestId,
          });
        }
        const delay = envNumber("MASSIVE_RETRY_DELAY_MS", 100) * 2 ** attempt + Math.random() * 25;
        await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 2_000)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new MarketDataProviderError("Massive request failed", {
      provider: "massive",
      status: lastStatus,
      code: "upstream_error",
      requestId: lastRequestId,
    });
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return null;
    const body = await this.request<MassiveTickerSnapshot>(
      `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(sym)}`,
    );
    const ticker = (body as MassiveTickerSnapshot).ticker;
    const lastTrade = ticker?.lastTrade;
    const day = ticker?.day;
    const lastQuote = ticker?.lastQuote;
    const previous = numberOrUndefined(ticker?.prevDay?.c);
    const bid = numberOrUndefined(lastQuote?.P);
    const ask = numberOrUndefined(lastQuote?.p);
    const quotePrice =
      bid !== undefined && ask !== undefined
        ? (bid + ask) / 2
        : (ask ?? bid ?? numberOrUndefined(day?.c));
    const price = numberOrUndefined(lastTrade?.p) ?? quotePrice;
    if (price === undefined || previous === undefined) return null;
    const change = price - previous;
    const mode = freshness();
    const disclaimer =
      mode === "real-time"
        ? "real-time, source: Massive"
        : mode === "delayed"
          ? "delayed, source: Massive"
          : mode === "end-of-day"
            ? "end-of-day, source: Massive"
            : "freshness depends on Massive subscription, source: Massive";
    return {
      symbol: sym,
      price,
      change,
      changePct: previous !== 0 ? (change / previous) * 100 : 0,
      currency: ticker?.currencyName ?? "USD",
      ts: isoFromTimestamp(lastTrade?.t ?? lastQuote?.t ?? ticker?.updated ?? day?.t),
      disclaimer,
      name: ticker?.name,
      provider: "massive",
      freshness: mode,
    };
  }

  async getHistoricalCloses(
    symbol: string,
    period: "1mo" | "3mo" | "6mo" | "1y",
  ): Promise<HistoryPoint[] | null> {
    const { from, to } = dateRange(period);
    const body = await this.request<MassiveAggregate>(
      `/v2/aggs/ticker/${encodeURIComponent(symbol.trim().toUpperCase())}/range/1/day/${from}/${to}`,
      {
        adjusted: true,
        sort: "asc",
        limit: 50_000,
      },
    );
    const rows = Array.isArray(body.results) ? body.results : [];
    const points = rows.flatMap((row) => {
      const ts = numberOrUndefined(row.t);
      const close = numberOrUndefined(row.c);
      return ts !== undefined && close !== undefined && close > 0
        ? [{ ts: Math.floor(ts / 1_000), close }]
        : [];
    });
    return points.length >= 2 ? points : null;
  }

  async getAggregatesPage(query: AggregateQuery): Promise<AggregatePage> {
    const body = await this.request<MassiveAggregate>(
      `/v2/aggs/ticker/${encodeURIComponent(query.symbol.trim().toUpperCase())}/range/${query.multiplier}/${query.timespan}/${query.from}/${query.to}`,
      {
        adjusted: query.adjusted ?? true,
        sort: "asc",
        limit: 50_000,
      },
    );
    const rows = Array.isArray(body.results) ? body.results : [];
    const points = rows.flatMap((row) => {
      const ts = numberOrUndefined(row.t);
      const open = numberOrUndefined(row.o);
      const high = numberOrUndefined(row.h);
      const low = numberOrUndefined(row.l);
      const close = numberOrUndefined(row.c);
      if (
        ts === undefined ||
        open === undefined ||
        high === undefined ||
        low === undefined ||
        close === undefined
      )
        return [];
      return [
        {
          ts: Math.floor(ts / 1_000),
          open,
          high,
          low,
          close,
          volume: row.v,
          vwap: row.vw,
          transactions: row.n,
        },
      ];
    });
    return {
      points,
      nextCursor: cursorFromNextUrl(body.next_url),
      requestId: body.request_id,
    };
  }

  async getAggregates(query: AggregateQuery): Promise<AggregateBar[]> {
    return (await this.getAggregatesPage(query)).points;
  }

  async getOptionsChain(query: OptionsChainQuery): Promise<ProviderPage<OptionSnapshot>> {
    const body = await this.request<MassiveOptionSnapshot>(
      `/v3/snapshot/options/${encodeURIComponent(query.underlyingTicker.trim().toUpperCase())}`,
      {
        expiration_date: query.expirationDate,
        contract_type: query.contractType,
        strike_price: query.strikePrice,
        limit: query.limit ?? 250,
        cursor: query.cursor,
      },
    );
    return {
      results: (Array.isArray(body.results) ? body.results : []).flatMap((row) => {
        const mapped = mapSnapshot(row);
        return mapped ? [mapped] : [];
      }),
      nextCursor: cursorFromNextUrl(body.next_url),
      requestId: body.request_id,
    };
  }

  async getOptionContracts(query: OptionContractQuery): Promise<ProviderPage<OptionContract>> {
    const body = await this.request<MassiveContract>("/v3/reference/options/contracts", {
      underlying_ticker: query.underlyingTicker,
      ticker: query.ticker,
      contract_type: query.contractType,
      expiration_date: query.expirationDate,
      as_of: query.asOf,
      strike_price: query.strikePrice,
      expired: query.expired,
      limit: query.limit ?? 100,
      cursor: query.cursor,
    });
    return {
      results: (Array.isArray(body.results) ? body.results : []).flatMap((row) => {
        const mapped = mapContract(row);
        return mapped ? [mapped] : [];
      }),
      nextCursor: cursorFromNextUrl(body.next_url),
      requestId: body.request_id,
    };
  }

  async getOptionContract(ticker: string): Promise<OptionContract | null> {
    const body = await this.request<MassiveContract>(
      `/v3/reference/options/contracts/${encodeURIComponent(ticker.trim().toUpperCase())}`,
    );
    return mapContract(body.results && !Array.isArray(body.results) ? body.results : {});
  }

  async getCorporateEvents(query: {
    ticker?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<CorporateEvent[]> {
    const [splits, dividends] = await Promise.all([
      this.request<Record<string, unknown>>("/stocks/v1/splits", {
        ticker: query.ticker,
        limit: Math.min(query.limit ?? 100, 250),
      }),
      this.request<Record<string, unknown>>("/stocks/v1/dividends", {
        ticker: query.ticker,
        limit: Math.min(query.limit ?? 100, 250),
      }),
    ]);
    const splitEvents = (Array.isArray(splits.results) ? splits.results : []).map((row) => ({
      id: typeof row.id === "string" ? row.id : undefined,
      ticker: typeof row.ticker === "string" ? row.ticker : (query.ticker ?? ""),
      type: "split",
      provider: "massive" as const,
      date: typeof row.execution_date === "string" ? row.execution_date : undefined,
      description: `${String(row.split_from ?? "?")} for ${String(row.split_to ?? "?")} split`,
      raw: row,
    }));
    const dividendEvents = (Array.isArray(dividends.results) ? dividends.results : []).map(
      (row) => ({
        id: typeof row.id === "string" ? row.id : undefined,
        ticker: typeof row.ticker === "string" ? row.ticker : (query.ticker ?? ""),
        type: "dividend",
        provider: "massive" as const,
        date: typeof row.ex_dividend_date === "string" ? row.ex_dividend_date : undefined,
        description:
          typeof row.cash_amount === "number" ? `Cash dividend ${row.cash_amount}` : undefined,
        raw: row,
      }),
    );
    return [...splitEvents, ...dividendEvents]
      .filter((event) => {
        if (!event.date) return false;
        if (query.from && event.date < query.from) return false;
        if (query.to && event.date > query.to) return false;
        return true;
      })
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, Math.min(query.limit ?? 100, 500));
  }

  async getTmxCorporateEvents(query: {
    ticker?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<CorporateEvent[]> {
    if (process.env.MASSIVE_CORPORATE_EVENTS_ENABLED !== "1") return [];
    const body = await this.request<MassiveTmxEvent>("/tmx/v1/corporate-events", {
      ticker: query.ticker,
      "date.gte": query.from,
      "date.lte": query.to,
      limit: Math.min(query.limit ?? 100, 500),
      sort: "date.desc",
    });
    const rows = Array.isArray(body.results) ? body.results : body.results ? [body.results] : [];
    return rows
      .flatMap((row) => {
        if (!row.ticker || !row.type || !row.date) return [];
        return [
          {
            ticker: row.ticker,
            type: row.type,
            date: row.date,
            status: row.status,
            description: row.name,
            sourceUrl: row.url,
            provider: "tmx" as const,
            companyName: row.company_name,
            isin: row.isin,
            tradingVenue: row.trading_venue,
            tmxRecordId: row.tmx_record_id,
          },
        ];
      })
      .filter(
        (event) =>
          (!query.from || (event.date ?? "") >= query.from) &&
          (!query.to || (event.date ?? "") <= query.to),
      )
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, Math.min(query.limit ?? 100, 500));
  }
}

export const massiveClient = new MassiveClient();
