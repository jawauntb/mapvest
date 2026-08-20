import { UNDERLYING_API_URL } from "@/util/env";
import { ApiError } from "./client";

/**
 * Typed client for The Underlying Analyzer's chart-DATA endpoints (JSON
 * series, not PNG images):
 *
 *   POST /api/data/charts/<chart_type>  — batch envelope with datasets[]
 *   POST /api/data/tools/torque         — single torque dataset, top level
 *   POST /api/data/tools/moneyline      — single OI-ladder dataset, top level
 *
 * Shapes mirror the analyzer's rendering guide (docs/chart-data-rendering.md
 * in underlying-analyzer-reboot) and its builders in app/chart_data.py.
 */

// -------- point shapes --------

export type ValuePoint = { date: string; value: number };

export type OhlcvPoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// -------- per-chart datasets --------

export type AuctionLevels = { vah: number; val: number; poc: number };

export type AuctionObservation = AuctionLevels & {
  /** "above value" | "inside value" | "below value" */
  location: string;
  distance_to_poc: number;
};

export type AuctionDataset = {
  chart_type: "auction";
  ticker: string;
  period: string;
  provider?: string;
  meta: AuctionObservation;
  levels: AuctionLevels;
  series: { ohlcv: OhlcvPoint[]; close: ValuePoint[] };
};

export type PerformanceRow = {
  month: number;
  month_label: string;
  /** Keyed by column name ("2017"…"2026", "Mean 5Y", "Median 5Y"); null = no data. */
  values: Record<string, number | null>;
};

export type PerformanceDataset = {
  chart_type: "performance";
  ticker: string;
  provider?: string;
  meta: { selected_month: string; mean_5y: number };
  table: { columns: string[]; rows: PerformanceRow[] };
};

export type RegressionDataset = {
  chart_type: "regression";
  ticker: string;
  provider?: string;
  meta: { slope_per_day: number; residual_std: number; intercept: number };
  series: {
    ohlcv: OhlcvPoint[];
    close: ValuePoint[];
    trend: ValuePoint[];
    upper_band: ValuePoint[];
    lower_band: ValuePoint[];
    ema21: ValuePoint[];
    ema50: ValuePoint[];
    ema200: ValuePoint[];
    volume: ValuePoint[];
  };
};

export type RidgeTrade = {
  entry_date: string;
  exit_date: string;
  quantity: number;
  entry_price: number;
  exit_price: number;
  pnl: number;
  return: number;
};

export type RidgeSignalPoint = {
  date: string;
  Close: number | null;
  Low: number | null;
  High: number | null;
  in_trade: boolean | null;
  buy_signal: boolean | null;
  sell_signal: boolean | null;
  trend_on: boolean | null;
  trend_confirmed: boolean | null;
  rsi_14: number | null;
};

export type FlowCompassSummary = {
  state: string;
  score: number | null;
  signal: number | null;
};

export type RidgeGrowthDataset = {
  chart_type: "ridge-growth";
  ticker: string;
  /** One dataset per fixed window: "6mo" | "1y" | "2y". */
  period: string;
  provider?: string;
  meta: {
    state: "LONG" | "WATCH" | "CASH";
    recommendation: string;
    ending_equity: number;
    total_return: number;
    max_drawdown: number;
    closed_trades: number;
    win_rate: number;
    buy_count: number;
    sell_count: number;
    open_position_qty: number;
    open_position_return: number | null;
    latest_close: number | null;
    trend_confirmed: boolean;
    exit_style: string;
    large_cap_caveat?: string;
    trades: RidgeTrade[];
    flow_compass: FlowCompassSummary;
    auction: AuctionObservation;
    /** Markdown memo, present on the last window only. */
    analysis_memo?: string;
  };
  series: {
    ohlcv: OhlcvPoint[];
    close: ValuePoint[];
    fast_ma: ValuePoint[];
    base_ma: ValuePoint[];
    major_ma: ValuePoint[];
    equity: ValuePoint[];
    signals: RidgeSignalPoint[];
  };
};

export type FlowSignalPoint = {
  date: string;
  Close: number | null;
  Low: number | null;
  High: number | null;
  flow_score: number | null;
  compass_signal: number | null;
  fresh_long: boolean | null;
  fresh_short: boolean | null;
  long_ok: boolean | null;
  short_ok: boolean | null;
  state: string | null;
  volume_score: number | null;
  trend_score: number | null;
  momentum_score: number | null;
  value_score: number | null;
  rvi_score: number | null;
};

export type FlowCompassDataset = {
  chart_type: "flow-compass";
  ticker: string;
  period: string;
  provider?: string;
  meta: {
    /** STRONG LONG | LONG OK | STRONG SHORT | AVOID CALLS | NEUTRAL */
    state: string;
    score: number | null;
    signal: number | null;
    volume_score: number | null;
    trend_score: number | null;
    momentum_score: number | null;
    value_score: number | null;
    rvi_score: number | null;
    fresh_long: boolean;
    fresh_short: boolean;
    trigger_level: number;
    strong_level: number;
  };
  levels: { trigger_level: number; strong_level: number };
  series: {
    ohlcv: OhlcvPoint[];
    close: ValuePoint[];
    flow_score: ValuePoint[];
    compass_signal: ValuePoint[];
    signals: FlowSignalPoint[];
  };
};

export type TorqueComponent = {
  name: string;
  score: number;
  weight: number;
  detail: string;
};

export type QuarterPoint = { label: string; value: number };

export type TorqueStage =
  | "Coiled Spring"
  | "Inflecting"
  | "Proof Phase"
  | "Renaming Phase"
  | "Extended"
  | "No Setup";

export type TorqueDataset = {
  chart_type: "torque";
  ticker: string;
  provider?: string;
  meta: {
    total_score: number;
    stage_label: TorqueStage;
    stage_detail: string;
    recommendation: string;
    target_zone: string;
    /**
     * Whether the SEC trend pack existed at all. The quarterly fundamentals
     * arrays below can still be empty when this is true (observed live for
     * AAPL) — key panels off the arrays, use this flag only for messaging.
     */
    fundamental_data_available: boolean;
  };
  torque: {
    total_score: number;
    stage_label: TorqueStage;
    stage_detail: string;
    recommendation: string;
    components: TorqueComponent[];
    target_zone: string;
  };
  series: {
    /** Empty object when no price history exists. */
    price: {
      close?: ValuePoint[];
      ema75?: ValuePoint[];
      sma200?: ValuePoint[];
      sma50?: ValuePoint[];
      ohlcv?: OhlcvPoint[];
    };
    fundamentals: {
      revenue: QuarterPoint[];
      gross_margin: QuarterPoint[];
      operating_margin: QuarterPoint[];
    };
  };
};

export type PortfolioDataset = {
  chart_type: "portfolio";
  tickers: string[];
  provider?: string;
  meta: {
    final_values: Record<string, number>;
    initial_value: number;
    portfolio_final: number;
    total_return: number;
    max_drawdown: number;
    annualized_volatility: number;
    investment_per_stock: number;
    /** Benchmark keys exist only when the benchmark resolved. */
    benchmark_ticker?: string;
    benchmark_return?: number;
    alpha_vs_benchmark?: number;
    benchmark_final?: number;
  };
  series: {
    portfolio: ValuePoint[];
    holdings: Record<string, ValuePoint[]>;
    benchmark?: ValuePoint[];
  };
};

export type VolatilityRow = {
  ticker: string;
  price: number;
  daily_vol: number;
  annual_vol: number;
  one_week_range: number;
  one_month_range: number;
};

export type VolatilityDataset = {
  chart_type: "volatility";
  tickers: string[];
  provider?: string;
  /** Pre-sorted by annual_vol descending. */
  rows: VolatilityRow[];
};

export type MoneylineStrike = {
  strike: number;
  call_open_interest: number;
  put_open_interest: number;
  call_last: number;
  put_last: number;
  net_open_interest: number;
  put_call_ratio: number;
};

export type MoneylineDataset = {
  chart_type: "moneyline";
  ticker: string;
  meta: { ticker: string; expiry: string; current_price: number };
  series: { strikes: MoneylineStrike[] };
  rows: MoneylineStrike[];
};

// -------- envelope + requests --------

export type TickerError = { ticker: string; error: string };

export type ChartDataEnvelope<D> = {
  datasets: D[];
  provider: string;
  provider_note?: string;
  meta: {
    result_count: number;
    error_count: number;
    watchlist_name?: string;
    errors: TickerError[];
  };
};

export type BatchChartType =
  | "auction"
  | "performance"
  | "regression"
  | "ridge-growth"
  | "flow-compass"
  | "torque"
  | "portfolio"
  | "volatility";

type DatasetByType = {
  auction: AuctionDataset;
  performance: PerformanceDataset;
  regression: RegressionDataset;
  "ridge-growth": RidgeGrowthDataset;
  "flow-compass": FlowCompassDataset;
  torque: TorqueDataset;
  portfolio: PortfolioDataset;
  volatility: VolatilityDataset;
};

export type ChartDataRequest = {
  ticker?: string;
  tickers?: string | string[];
  watchlist_url?: string;
  max_results?: number;
  /** auction / regression / flow-compass / torque */
  period?: string;
  /** 15m / 1d / 1w — last bar is the live snapshot */
  interval?: string;
  /** performance: 1–12 */
  month?: number;
  /** portfolio */
  investment_per_stock?: number;
  benchmark_ticker?: string;
  start_date?: string;
  end_date?: string;
};

type FetchOpts = { signal?: AbortSignal };

async function underlyingFetch<T>(
  path: string,
  body: Record<string, unknown>,
  opts: FetchOpts = {},
): Promise<T> {
  const res = await fetch(`${UNDERLYING_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text || res.statusText;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (typeof j.error === "string" && j.error.trim()) message = j.error;
    } catch {
      /* plain-text body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

/** Batch chart data: one dataset per ticker (per window for ridge-growth). */
export function fetchChartData<T extends BatchChartType>(
  chartType: T,
  body: ChartDataRequest,
  opts: FetchOpts = {},
): Promise<ChartDataEnvelope<DatasetByType[T]>> {
  return underlyingFetch(`/api/data/charts/${chartType}`, body, opts);
}

/**
 * Single-ticker torque dashboard dataset (score + chartable series). The tool
 * route pins a 2y daily window server-side; use `fetchChartData("torque", …)`
 * if a custom period is ever needed.
 */
export function fetchTorqueData(
  body: { ticker: string },
  opts: FetchOpts = {},
): Promise<TorqueDataset> {
  return underlyingFetch("/api/data/tools/torque", body, opts);
}

/** Single-ticker options open-interest ladder dataset. */
export function fetchMoneylineData(
  body: { ticker: string; expiry?: string },
  opts: FetchOpts = {},
): Promise<MoneylineDataset> {
  return underlyingFetch("/api/data/tools/moneyline", body, opts);
}
