import type { Source } from "@mapvest/core";
import type { Quote } from "../quote.js";
import {
  type HistoryInterval,
  type HistoryPeriod,
  historyDateRange,
  massiveIntervalSpec,
} from "./historyIntervals.js";
import {
  type AggregateBar,
  type AggregatePage,
  type AggregateQuery,
  type CorporateEvent,
  type FinancialRatios,
  type FinancialRatiosQuery,
  type HistoryPoint,
  type MarketDataCapabilities,
  MarketDataProviderError,
  type OptionAggregateQuery,
  type OptionContract,
  type OptionContractQuery,
  type OptionSnapshot,
  type OptionSnapshotQuery,
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
type MassiveFinancialRatios = {
  ticker?: string;
  cik?: string;
  date?: string;
  price?: number;
  average_volume?: number;
  market_cap?: number;
  earnings_per_share?: number;
  price_to_earnings?: number;
  price_to_book?: number;
  price_to_sales?: number;
  price_to_cash_flow?: number;
  price_to_free_cash_flow?: number;
  dividend_yield?: number;
  return_on_assets?: number;
  return_on_equity?: number;
  debt_to_equity?: number;
  current?: number;
  quick?: number;
  cash?: number;
  ev_to_sales?: number;
  ev_to_ebitda?: number;
  enterprise_value?: number;
  free_cash_flow?: number;
};

/**
 * Raw financial-statement row. Massive exposes the statement families as flat
 * snake_case rows; field names differ slightly between the income-statement and
 * cash-flow endpoints and have picked up aliases across API revisions, so every
 * numeric is resolved through `pickNumber` over a list of accepted names rather
 * than a single hard-coded key. A field that is absent stays `undefined` — it is
 * never zero-filled (AGENTS.md §2.4: never fake financial data).
 */
type MassiveStatementRow = Record<string, unknown>;

/** Query options for the financial-statement endpoints. */
export type FinancialStatementQuery = {
  /** Max statements to return, newest first. Massive caps this server-side. */
  limit?: number;
  /** Fiscal period filter, when the caller wants only annual or only quarterly rows. */
  period?: "annual" | "quarterly";
  /** Opaque pagination cursor from a previous page. */
  cursor?: string;
};

/** Normalized income statement (one fiscal period). */
export type IncomeStatement = {
  ticker: string;
  /** Fiscal period label as reported, e.g. `"FY"`, `"Q3"`, or `"FY2024"`. */
  period: string;
  /** Period end date, `YYYY-MM-DD`. */
  fiscalDate: string;
  fiscalYear?: string;
  filingDate?: string;
  revenue?: number;
  costOfRevenue?: number;
  grossProfit?: number;
  operatingExpenses?: number;
  operatingIncome?: number;
  netIncome?: number;
  dilutedEps?: number;
  currency?: string;
};

/** Normalized cash-flow statement (one fiscal period). */
export type CashFlowStatement = {
  ticker: string;
  period: string;
  fiscalDate: string;
  fiscalYear?: string;
  filingDate?: string;
  operatingCashFlow?: number;
  investingCashFlow?: number;
  financingCashFlow?: number;
  /** Capital expenditure as a positive magnitude (providers report it signed). */
  capex?: number;
  /** Operating cash flow less capex; omitted unless both inputs were reported. */
  freeCashFlow?: number;
  netChangeInCash?: number;
  currency?: string;
};

/**
 * A page of normalized statements plus the provenance of the call that produced
 * it. `sources` is empty only when `results` is — an uncitable statement is not
 * emitted (AGENTS.md §6).
 */
export type FinancialStatementPage<T> = {
  results: T[];
  sources: Source[];
  nextCursor?: string;
  requestId?: string;
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
  const seconds =
    value >= 100_000_000_000_000_000
      ? value / 1_000_000_000
      : value >= 100_000_000_000_000
        ? value / 1_000_000
        : value >= 100_000_000_000
          ? value / 1_000
          : value;
  const millis = seconds * 1_000;
  return new Date(millis).toISOString();
}

function unixSeconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  if (value >= 100_000_000_000_000_000) return Math.floor(value / 1_000_000_000);
  if (value >= 100_000_000_000_000) return Math.floor(value / 1_000_000);
  if (value >= 100_000_000_000) return Math.floor(value / 1_000);
  return Math.floor(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** First finite number found under any of `names`; `undefined` when none. */
function pickNumber(row: MassiveStatementRow, names: readonly string[]): number | undefined {
  for (const name of names) {
    const direct = numberOrUndefined(row[name]);
    if (direct !== undefined) return direct;
    // Some statement revisions wrap each line item as `{ value, unit, label }`.
    const wrapped = row[name];
    if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) {
      const value = numberOrUndefined((wrapped as { value?: unknown }).value);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

/** First non-empty string found under any of `names`; `undefined` when none. */
function pickString(row: MassiveStatementRow, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = row[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

const FISCAL_DATE_KEYS = [
  "period_end_date",
  "end_date",
  "fiscal_date",
  "period_of_report_date",
  "date",
] as const;
const FISCAL_PERIOD_KEYS = ["fiscal_period", "period", "timeframe"] as const;
const FISCAL_YEAR_KEYS = ["fiscal_year", "year"] as const;
const FILING_DATE_KEYS = ["filing_date", "acceptance_datetime"] as const;

/** Shared period identity for both statement families; `null` when undatable. */
function statementPeriod(
  row: MassiveStatementRow,
  fallbackTicker: string,
): {
  ticker: string;
  period: string;
  fiscalDate: string;
  fiscalYear?: string;
  filingDate?: string;
} | null {
  const fiscalDate = pickString(row, FISCAL_DATE_KEYS);
  if (!fiscalDate) return null;
  const fiscalYear = pickString(row, FISCAL_YEAR_KEYS);
  const rawPeriod = pickString(row, FISCAL_PERIOD_KEYS);
  const period = rawPeriod
    ? fiscalYear && !rawPeriod.includes(fiscalYear)
      ? `${rawPeriod}${fiscalYear}`
      : rawPeriod
    : fiscalDate;
  return {
    ticker: pickString(row, ["ticker", "symbol"]) ?? fallbackTicker,
    period,
    fiscalDate: fiscalDate.slice(0, 10),
    fiscalYear,
    filingDate: pickString(row, FILING_DATE_KEYS),
  };
}

function mapIncomeStatement(
  row: MassiveStatementRow,
  fallbackTicker: string,
): IncomeStatement | null {
  const base = statementPeriod(row, fallbackTicker);
  if (!base) return null;
  return {
    ...base,
    revenue: pickNumber(row, ["revenues", "revenue", "total_revenue", "total_revenues"]),
    costOfRevenue: pickNumber(row, ["cost_of_revenue", "costs_and_expenses", "cost_of_goods_sold"]),
    grossProfit: pickNumber(row, ["gross_profit"]),
    operatingExpenses: pickNumber(row, ["operating_expenses", "total_operating_expenses"]),
    operatingIncome: pickNumber(row, ["operating_income_loss", "operating_income"]),
    netIncome: pickNumber(row, [
      "net_income_loss",
      "net_income",
      "net_income_loss_attributable_to_parent",
    ]),
    dilutedEps: pickNumber(row, ["diluted_earnings_per_share", "eps_diluted"]),
    currency: pickString(row, ["currency", "currency_code", "reporting_currency"]),
  };
}

function mapCashFlowStatement(
  row: MassiveStatementRow,
  fallbackTicker: string,
): CashFlowStatement | null {
  const base = statementPeriod(row, fallbackTicker);
  if (!base) return null;
  const operatingCashFlow = pickNumber(row, [
    "net_cash_flow_from_operating_activities",
    "operating_cash_flow",
    "net_cash_provided_by_operating_activities",
  ]);
  const rawCapex = pickNumber(row, [
    "capital_expenditures",
    "capital_expenditure",
    "capex",
    "purchase_of_property_plant_and_equipment",
    "payments_to_acquire_property_plant_and_equipment",
  ]);
  // Providers report capex either signed (an investing outflow) or as a
  // magnitude. Normalize to a positive magnitude so growth math is comparable.
  const capex = rawCapex === undefined ? undefined : Math.abs(rawCapex);
  return {
    ...base,
    operatingCashFlow,
    investingCashFlow: pickNumber(row, [
      "net_cash_flow_from_investing_activities",
      "investing_cash_flow",
    ]),
    financingCashFlow: pickNumber(row, [
      "net_cash_flow_from_financing_activities",
      "financing_cash_flow",
    ]),
    capex,
    freeCashFlow:
      operatingCashFlow !== undefined && capex !== undefined
        ? operatingCashFlow - capex
        : pickNumber(row, ["free_cash_flow"]),
    netChangeInCash: pickNumber(row, ["net_cash_flow", "net_change_in_cash"]),
    currency: pickString(row, ["currency", "currency_code", "reporting_currency"]),
  };
}

function dateRange(period: HistoryPeriod): { from: string; to: string } {
  return historyDateRange(period);
}

function cursorFromNextUrl(nextUrl: string | undefined): string | undefined {
  if (!nextUrl) return undefined;
  try {
    return new URL(nextUrl).searchParams.get("cursor") ?? undefined;
  } catch {
    return undefined;
  }
}

function optionTicker(query: OptionSnapshotQuery | OptionAggregateQuery): string {
  if ("optionTicker" in query) return query.optionTicker;
  return query.ticker;
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

function mapSnapshot(
  value: MassiveOptionSnapshot,
  fallbackUnderlyingTicker?: string,
): OptionSnapshot | null {
  const contract = mapContract(value.details ?? value);
  if (!contract) return null;
  return {
    ...contract,
    underlyingTicker: contract.underlyingTicker ?? fallbackUnderlyingTicker,
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
        financialRatios: {
          supported: true,
          access,
          note: "End-of-day ratios calculated from TTM financials and the latest available stock price.",
        },
        optionSnapshot: {
          supported: true,
          access,
          note: "Single-contract snapshot with Greeks, IV, open interest, quote, and trade data.",
        },
        optionAggregates: {
          supported: true,
          access,
          note: "Historical option OHLCV bars use the standard aggregate endpoint.",
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

  /**
   * Absolute request URL for a path + query. Extracted from `request` so the
   * statement endpoints can cite the exact URL they fetched without rebuilding
   * the query independently (the API key travels in the Authorization header,
   * never in the URL, so the cited URL carries no secret).
   */
  private buildUrl(
    pathOrUrl: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ): string {
    const target = pathOrUrl.startsWith("http")
      ? new URL(pathOrUrl)
      : new URL(`${this.baseUrl}${pathOrUrl}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && !target.searchParams.has(key))
        target.searchParams.set(key, String(value));
    }
    return target.toString();
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
    const url = this.buildUrl(pathOrUrl, query);
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
    period: HistoryPeriod,
    interval: HistoryInterval = "1d",
  ): Promise<HistoryPoint[] | null> {
    const { from, to } = dateRange(period);
    const { multiplier, timespan } = massiveIntervalSpec(interval);
    const body = await this.request<MassiveAggregate>(
      `/v2/aggs/ticker/${encodeURIComponent(symbol.trim().toUpperCase())}/range/${multiplier}/${timespan}/${from}/${to}`,
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
    return this.getAggregatePageForSymbol(query.symbol, query);
  }

  private async getAggregatePageForSymbol(
    symbol: string,
    query: Pick<AggregateQuery, "from" | "to" | "multiplier" | "timespan" | "adjusted" | "cursor">,
  ): Promise<AggregatePage> {
    const body = await this.request<MassiveAggregate>(
      `/v2/aggs/ticker/${encodeURIComponent(symbol.trim().toUpperCase())}/range/${query.multiplier}/${query.timespan}/${query.from}/${query.to}`,
      {
        adjusted: query.adjusted ?? true,
        sort: "asc",
        limit: 50_000,
        cursor: query.cursor,
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

  async getFinancialRatios(
    query: FinancialRatiosQuery = {},
  ): Promise<ProviderPage<FinancialRatios>> {
    const body = await this.request<MassiveFinancialRatios>("/stocks/financials/v1/ratios", {
      ticker: query.ticker,
      cik: query.cik,
      price: query.price,
      average_volume: query.averageVolume,
      market_cap: query.marketCap,
      earnings_per_share: query.earningsPerShare,
      price_to_earnings: query.priceToEarnings,
      price_to_book: query.priceToBook,
      price_to_sales: query.priceToSales,
      price_to_cash_flow: query.priceToCashFlow,
      price_to_free_cash_flow: query.priceToFreeCashFlow,
      dividend_yield: query.dividendYield,
      return_on_assets: query.returnOnAssets,
      return_on_equity: query.returnOnEquity,
      debt_to_equity: query.debtToEquity,
      current: query.current,
      quick: query.quick,
      cash: query.cash,
      ev_to_sales: query.evToSales,
      ev_to_ebitda: query.evToEbitda,
      enterprise_value: query.enterpriseValue,
      free_cash_flow: query.freeCashFlow,
      limit: Math.min(query.limit ?? 100, 50_000),
      sort: query.sort,
      cursor: query.cursor,
    });
    return {
      results: (Array.isArray(body.results) ? body.results : []).flatMap((row) => {
        if (!row.ticker) return [];
        return [
          {
            ticker: row.ticker,
            cik: row.cik,
            date: row.date,
            price: numberOrUndefined(row.price),
            averageVolume: numberOrUndefined(row.average_volume),
            marketCap: numberOrUndefined(row.market_cap),
            earningsPerShare: numberOrUndefined(row.earnings_per_share),
            priceToEarnings: numberOrUndefined(row.price_to_earnings),
            priceToBook: numberOrUndefined(row.price_to_book),
            priceToSales: numberOrUndefined(row.price_to_sales),
            priceToCashFlow: numberOrUndefined(row.price_to_cash_flow),
            priceToFreeCashFlow: numberOrUndefined(row.price_to_free_cash_flow),
            dividendYield: numberOrUndefined(row.dividend_yield),
            returnOnAssets: numberOrUndefined(row.return_on_assets),
            returnOnEquity: numberOrUndefined(row.return_on_equity),
            debtToEquity: numberOrUndefined(row.debt_to_equity),
            current: numberOrUndefined(row.current),
            quick: numberOrUndefined(row.quick),
            cash: numberOrUndefined(row.cash),
            evToSales: numberOrUndefined(row.ev_to_sales),
            evToEbitda: numberOrUndefined(row.ev_to_ebitda),
            enterpriseValue: numberOrUndefined(row.enterprise_value),
            freeCashFlow: numberOrUndefined(row.free_cash_flow),
          },
        ];
      }),
      nextCursor: cursorFromNextUrl(body.next_url),
      requestId: body.request_id,
    };
  }

  /** Shared plumbing for the two financial-statement families. */
  private async getStatements<T>(
    path: string,
    symbol: string,
    query: FinancialStatementQuery,
    map: (row: MassiveStatementRow, ticker: string) => T | null,
  ): Promise<FinancialStatementPage<T>> {
    const ticker = symbol.trim().toUpperCase();
    if (!ticker) return { results: [], sources: [] };
    const params = {
      ticker,
      timeframe: query.period,
      limit: Math.min(Math.max(query.limit ?? 8, 1), 100),
      sort: "period_end_date.desc",
      cursor: query.cursor,
    };
    const url = this.buildUrl(path, params);
    const body = await this.request<MassiveStatementRow>(path, params);
    const rows = Array.isArray(body.results) ? body.results : body.results ? [body.results] : [];
    const results = rows.flatMap((row) => {
      const mapped = map(row, ticker);
      return mapped ? [mapped] : [];
    });
    return {
      results,
      // Provenance for a real call that really returned rows — never a citation
      // manufactured around an empty response (AGENTS.md §6).
      sources:
        results.length > 0
          ? [{ provider: "massive", url, fetchedAt: new Date().toISOString(), confidence: "high" }]
          : [],
      nextCursor: cursorFromNextUrl(body.next_url),
      requestId: body.request_id,
    };
  }

  /** Income statements for `symbol`, newest fiscal period first. */
  async getIncomeStatements(
    symbol: string,
    query: FinancialStatementQuery = {},
  ): Promise<FinancialStatementPage<IncomeStatement>> {
    return this.getStatements(
      "/stocks/financials/v1/income-statements",
      symbol,
      query,
      mapIncomeStatement,
    );
  }

  /** Cash-flow statements for `symbol`, newest fiscal period first. */
  async getCashFlowStatements(
    symbol: string,
    query: FinancialStatementQuery = {},
  ): Promise<FinancialStatementPage<CashFlowStatement>> {
    return this.getStatements(
      "/stocks/financials/v1/cash-flow-statements",
      symbol,
      query,
      mapCashFlowStatement,
    );
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
        const mapped = mapSnapshot(row, query.underlyingTicker.trim().toUpperCase());
        return mapped ? [mapped] : [];
      }),
      nextCursor: cursorFromNextUrl(body.next_url),
      requestId: body.request_id,
    };
  }

  async getOptionSnapshot(query: OptionSnapshotQuery): Promise<OptionSnapshot | null> {
    const underlying = query.underlyingTicker.trim().toUpperCase();
    const ticker = optionTicker(query).trim().toUpperCase();
    if (!underlying || !ticker) return null;
    const body = await this.request<MassiveOptionSnapshot>(
      `/v3/snapshot/options/${encodeURIComponent(underlying)}/${encodeURIComponent(ticker)}`,
    );
    const value = Array.isArray(body.results) ? body.results[0] : body.results;
    return value ? mapSnapshot(value, underlying) : null;
  }

  async getOptionAggregatesPage(query: OptionAggregateQuery): Promise<AggregatePage> {
    return this.getAggregatePageForSymbol(optionTicker(query), query);
  }

  async getOptionAggregates(query: OptionAggregateQuery): Promise<AggregateBar[]> {
    return (await this.getOptionAggregatesPage(query)).points;
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
        "execution_date.gte": query.from,
        "execution_date.lte": query.to,
        limit: Math.min(query.limit ?? 100, 250),
      }),
      this.request<Record<string, unknown>>("/stocks/v1/dividends", {
        ticker: query.ticker,
        "ex_dividend_date.gte": query.from,
        "ex_dividend_date.lte": query.to,
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
