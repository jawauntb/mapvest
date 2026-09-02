/**
 * Typed client for Prism (working name "ubermemo") — the full-stack memo
 * engine, proxied by the Mapvest API at `/v1/prism/*`.
 *
 *   POST /v1/prism                        build a packet (1–3 minutes, metered)
 *   GET  /v1/prism/:ticker                latest stored packet (404 = none yet)
 *   GET  /v1/prism/:ticker/summary        bounded agent projection
 *   POST /v1/prism/chat                   ask the packet a question
 *   GET  /v1/prism/:ticker/export?format= txt | json | pdf bytes
 *
 * The types below mirror the packet contract the engine publishes and the zod
 * schemas in `packages/core` (`PrismPacket`). Two rules from that contract are
 * load-bearing for every renderer in `src/prism`:
 *
 *   1. Every analytical section is always present but may be `null`. `null`
 *      means "could not compute", never "zero" — and a sibling
 *      `<section>_error` string says why. Never render a null as a 0.
 *   2. Percent returns are decimal fractions (0.034 = 3.4%). Dates are ISO.
 *
 * Sections are typed optimistically: every field is optional/nullable so a
 * packet from an older or newer engine still parses into something renderable.
 * Unknown keys survive (we cast the JSON rather than stripping it).
 */
import { API_URL } from "@/util/env";
import { ApiError } from "./errors";
import { apiFetch } from "./http";

export { ApiError } from "./errors";

// -------- shared vocabulary --------

// Re-exported from `src/prism/constants.ts` so the pure helpers (and their bun
// tests) can read the vocabulary without importing this module's fetch stack.
export {
  PRISM_EXPORT_FORMATS,
  PRISM_HORIZON_MONTHS,
  PRISM_HORIZONS,
  PRISM_REL_WINDOWS,
  PRISM_SEASON_WINDOWS,
  SCENARIO_CASES,
} from "@/prism/constants";
export type {
  PrismExportFormat,
  PrismHorizonKey,
  PrismRegimeLabel,
  PrismRelWindow,
  PrismScenarioCaseKey,
  PrismSeasonWindow,
} from "@/prism/constants";

import type {
  PrismExportFormat,
  PrismHorizonKey,
  PrismRelWindow,
  PrismScenarioCaseKey,
  PrismSeasonWindow,
} from "@/prism/constants";

type Num = number | null;

// -------- profile / universe --------

export type PrismProfile = {
  name?: string | null;
  sector?: string | null;
  industry?: string | null;
  market_cap?: Num;
  description?: string | null;
  listed_since?: string | null;
  primary_exchange?: string | null;
  related_etfs?: string[] | null;
};

export type PrismUniverseEntry = {
  symbol: string;
  label?: string | null;
  role?: string | null;
  provider?: string | null;
  first_date?: string | null;
  last_date?: string | null;
  n_days?: Num;
};

// -------- seasonality --------

export type PrismSeasonalYearValue = { year: number; ret: Num };

export type PrismSeasonalWindowStat = {
  mean?: Num;
  median?: Num;
  n?: Num;
  hit_rate?: Num;
  values?: PrismSeasonalYearValue[] | null;
};

export type PrismSeasonalForwardStat = {
  mean?: Num;
  median?: Num;
  n?: Num;
  hit_rate?: Num;
  p10?: Num;
  p90?: Num;
};

export type PrismSeasonalTrend = {
  direction?: string | null;
  slope?: Num;
  windows_used?: Num;
};

export type PrismSeasonalStats = {
  this_month?: Partial<Record<PrismSeasonWindow, PrismSeasonalWindowStat | null>> | null;
  trend?: PrismSeasonalTrend | null;
  forward?: Partial<Record<PrismHorizonKey, PrismSeasonalForwardStat | null>> | null;
};

export type PrismSeasonality = {
  month?: Num;
  month_label?: string | null;
  ticker?: PrismSeasonalStats | null;
  benchmarks?: Record<string, PrismSeasonalStats | null> | null;
};

// -------- macro --------

export type PrismMacroMonthlyPoint = {
  month: string;
  value?: Num;
  avg?: Num;
  change?: Num;
};

export type PrismMacroSeries = {
  series_id?: string | null;
  provider?: string | null;
  current?: Num;
  as_of?: string | null;
  change_1m?: Num;
  change_3m?: Num;
  change_12m?: Num;
  monthly_12?: PrismMacroMonthlyPoint[] | null;
  monthly?: PrismMacroMonthlyPoint[] | null;
};

export type PrismCurveShape = {
  "2s10s"?: Num;
  "5s20s"?: Num;
  label?: string | null;
};

export type PrismMacro = {
  yields?: Record<string, PrismMacroSeries | null> | null;
  vix?: PrismMacroSeries | null;
  gold?: PrismMacroSeries | null;
  hy_spread?: PrismMacroSeries | null;
  dollar?: PrismMacroSeries | null;
  wti?: PrismMacroSeries | null;
  brent?: PrismMacroSeries | null;
  fx?: Record<string, PrismMacroSeries | null> | null;
  btc?: PrismMacroSeries | null;
  nfp?: PrismMacroSeries | null;
  curve_shape?: PrismCurveShape | null;
};

// -------- relational --------

export type PrismRelationalStat = Partial<Record<PrismRelWindow, Num>> & {
  rolling_trend?: string | null;
  current_rolling_63d?: Num;
};

export type PrismKinematics = {
  velocity?: Num;
  acceleration?: Num;
  jerk?: Num;
  window_days?: Num;
};

export type PrismMatrix = {
  symbols?: string[] | null;
  matrix?: (number | null)[][] | null;
};

export type PrismRelativeMovingAverage = {
  value?: Num;
  signal?: string | null;
  components?: Record<string, Num> | null;
};

export type PrismImpactWeight = {
  weight?: Num;
  explained_variance_share?: Num;
};

export type PrismRelational = {
  reference_frame?: string | null;
  windows?: string[] | null;
  beta?: Record<string, PrismRelationalStat | null> | null;
  correlation?: Record<string, PrismRelationalStat | null> | null;
  kinematics?: Record<string, PrismKinematics | null> | null;
  cosine_similarity?: PrismMatrix | null;
  covariance?: PrismMatrix | null;
  relative_moving_average?: PrismRelativeMovingAverage | null;
  impact_weights?: Record<string, PrismImpactWeight | null> | null;
};

// -------- factors --------

export type PrismFactorWindow = {
  alpha_annual?: Num;
  betas?: Record<string, Num> | null;
  r2?: Num;
  residual_vol_annual?: Num;
  t_stats?: Record<string, Num> | null;
  n?: Num;
  /** ISO dates bounding the sample this window was fitted on. */
  start?: string | null;
  end?: string | null;
};

export type PrismFactors = {
  model?: string | null;
  source?: Record<string, unknown> | null;
  windows?: Record<string, PrismFactorWindow | null> | null;
  residuals?: {
    last_20d_cum?: Num;
    last_60d_cum?: Num;
    z_score?: Num;
  } | null;
  /**
   * Last date in the factor-return file, which is published on a lag — the
   * Fama-French series is typically a month or two behind the packet's own
   * `as_of`. `stale_days` is the engine's own count of that gap in calendar
   * days. Both are surfaced on the card: betas fitted through June cannot be
   * read as "current exposure" in September without saying so.
   */
  as_of?: string | null;
  stale_days?: Num;
  premia?: Record<string, unknown> | null;
};

// -------- regimes --------

export type PrismRegimeState = {
  id?: Num;
  label?: string | null;
  mean_daily_return?: Num;
  /**
   * NOT a volatility a reader can use: this is the raw HMM input feature —
   * mean squared deviation from the 10-day moving average, divided by the
   * squared moving average — so it lands around 1e-5 and printing it under a
   * "vol" label reads as 0.0%. `vol_feature_mean` is the engine's own alias
   * for the same number and `vol_feature_units` spells the units out.
   * {@link PrismRegimeState.volatility_annualized} is the figure to render.
   */
  volatility?: Num;
  vol_feature_mean?: Num;
  vol_feature_units?: string | null;
  /** The usable one: annualized volatility as a decimal fraction (0.097 = 9.7%). */
  volatility_annualized?: Num;
  std_daily_return?: Num;
  occupancy?: Num;
  stationary_occupancy?: Num;
  avg_duration_days?: Num;
  n_days?: Num;
};

export type PrismRegimeCurrent = {
  state?: Num;
  label?: string | null;
  posterior?: (number | null)[] | null;
  days_in_regime?: Num;
  switch_confidence?: Num;
};

export type PrismRegimeTickerStats = {
  mean_daily?: Num;
  std_daily?: Num;
  sharpe?: Num;
  n?: Num;
  hit_rate?: Num;
};

export type PrismRegimeHistoryPoint = { date: string; state?: Num; label?: string | null };

export type PrismRegimes = {
  trained_on?: string | null;
  n_states?: Num;
  features?: string[] | null;
  train_window_days?: Num;
  states?: PrismRegimeState[] | null;
  transition_matrix?: (number | null)[][] | null;
  current?: PrismRegimeCurrent | null;
  ticker_by_regime?: Record<string, PrismRegimeTickerStats | null> | null;
  history?: PrismRegimeHistoryPoint[] | null;
  fitted_distributions?: Record<string, unknown> | null;
};

// -------- entropy --------

export type PrismEntropyWindow = {
  H?: Num;
  classification?: string | null;
  n?: Num;
  window_days?: Num;
  /** Where this H sits in the ticker's own history of H, in `[0,1]`. */
  percentile?: Num;
  /** Same quantity under the recalibrated engine's name for it. */
  H_quantile?: Num;
  relative_classification?: string | null;
  history_min?: Num;
  history_max?: Num;
  history_median?: Num;
  /** Recalibration extras — shape not pinned; read defensively. */
  bin_grid?: unknown;
  sigma_full_sample?: Num;
};

export type PrismEntropyBacktest = {
  low_entropy_win_rate?: Num;
  high_entropy_win_rate?: Num;
  n_low?: Num;
  n_high?: Num;
  edge?: Num;
};

export type PrismEntropy = {
  bins?: Num;
  method?: string | null;
  thresholds?: Record<string, Num> | null;
  bin_edges?: (number | null)[] | null;
  windows?: Record<string, PrismEntropyWindow | null> | null;
  series?: { date: string; H?: Num }[] | null;
  backtest?: PrismEntropyBacktest | null;
};

// -------- spectral --------

export type PrismSpectralMode = {
  period_days?: Num;
  amplitude?: Num;
  phase_rad?: Num;
  power_share?: Num;
  cycle_position?: string | null;
  phase_fraction?: Num;
};

export type PrismSpectralProjection = {
  expected_return?: Num;
  confidence?: Num;
};

export type PrismSpectral = {
  detrend?: string | null;
  modes?: PrismSpectralMode[] | null;
  reconstruction_r2?: Num;
  projection?: Partial<Record<PrismHorizonKey, PrismSpectralProjection | null>> | null;
  consistency?: {
    recent_fit_error?: Num;
    z?: Num;
    likelihood_label?: string | null;
  } | null;
};

// -------- eigen --------

export type PrismSignalRank = {
  signal: string;
  corr_1y?: Num;
  corr_6m?: Num;
  corr_3m?: Num;
  rank?: Num;
};

export type PrismLoadBearing = {
  signal: string;
  weight_delta_if_removed?: Num;
  load_bearing?: boolean | null;
};

export type PrismEigen = {
  feature_names?: string[] | null;
  pca?: {
    explained_variance_ratio?: (number | null)[] | null;
    components?: (number | null)[][] | null;
  } | null;
  eigenvalues?: (number | null)[] | null;
  signal_ranking?: PrismSignalRank[] | null;
  symmetry?: {
    regime_correlation_flip?: unknown[] | null;
    gauge_invariant_pairs?: unknown[] | null;
    broken_pairs?: unknown[] | null;
  } | null;
  load_bearing?: PrismLoadBearing[] | null;
};

// -------- fundamentals --------

export type PrismQuarter = {
  period_end?: string | null;
  fiscal_quarter?: string | null;
  revenue?: Num;
  gross_profit?: Num;
  operating_income?: Num;
  net_income?: Num;
  eps?: Num;
  total_debt?: Num;
  cash?: Num;
  shares?: Num;
  fcf?: Num;
};

export type PrismFundamentals = {
  quarters?: PrismQuarter[] | null;
  ratios?: Record<string, Num> | null;
  growth?: Record<string, number | string | null> | null;
  moving_averages?: Record<string, Num> | null;
  forecast?: {
    next_4q?: Record<string, unknown> | null;
    method?: string | null;
  } | null;
  stage?: { label?: string | null; evidence?: string[] | null } | null;
};

// -------- filings --------

export type PrismFiling = {
  form?: string | null;
  filing_date?: string | null;
  report_date?: string | null;
  url?: string | null;
  sections?: Record<string, string | null> | null;
  summary?: string | null;
};

export type PrismFilings = {
  ten_k?: PrismFiling[] | null;
  ten_q?: PrismFiling[] | null;
  synthesis?: Record<string, string | null> | null;
};

// -------- volatility / levels --------

export type PrismRealizedVol = {
  annualized?: Num;
  avg?: Num;
  percentile?: Num;
};

export type PrismSmilePoint = {
  strike?: Num;
  moneyness?: Num;
  iv?: Num;
  type?: string | null;
};

export type PrismVolatility = {
  realized?: Record<string, PrismRealizedVol | null> | null;
  implied?: {
    atm_iv?: Num;
    expiry?: string | null;
    skew_25d?: Num;
    smile?: PrismSmilePoint[] | null;
  } | null;
  vol_of_vol?: Num;
  regime_avg?: Record<string, Num> | null;
};

export type PrismKeyLevel = {
  price?: Num;
  kind?: string | null;
  source?: string | null;
};

export type PrismLevels = {
  auction?: { vah?: Num; val?: Num; poc?: Num } | null;
  regression?: Record<string, Num> | null;
  torque?: Record<string, number | string | null> | null;
  ridge?: Record<string, number | string | null> | null;
  key_levels?: PrismKeyLevel[] | null;
};

// -------- news / recent --------

export type PrismNewsItem = {
  title?: string | null;
  url?: string | null;
  published?: string | null;
  source?: string | null;
  summary?: string | null;
  category?: string | null;
};

export type PrismNews = {
  items?: PrismNewsItem[] | null;
  query_log?: unknown[] | null;
};

export type PrismRecentWindow = {
  return?: Num;
  vs_spy?: Num;
  vs_sector?: Num;
  volatility?: Num;
  entropy?: Num;
  regime?: string | null;
  notable?: string | null;
};

export type PrismRecent = {
  last_20d?: PrismRecentWindow | null;
  last_60d?: PrismRecentWindow | null;
};

// -------- scenarios --------

export type PrismHorizonOutlook = {
  expected_return?: Num;
  p10?: Num;
  p50?: Num;
  p90?: Num;
  price_p10?: Num;
  price_p50?: Num;
  price_p90?: Num;
};

export type PrismScenarioCase = {
  probability?: Num;
  narrative?: string | null;
  horizons?: Partial<Record<PrismHorizonKey, PrismHorizonOutlook | null>> | null;
};

export type PrismEntryZone = {
  bargain_below?: Num;
  fair_value?: Num;
  expensive_above?: Num;
  current_price?: Num;
  current_vs_fair?: Num;
};

export type PrismWatchSignal = {
  symbol?: string | null;
  condition?: string | null;
  implication?: string | null;
};

export type PrismDistributionMoments = {
  mean?: Num;
  std?: Num;
  skew?: Num;
  kurtosis?: Num;
};

/**
 * The engine's own audit of how `weights` were arrived at. Present on every
 * real packet; the fields below are the ones the UI is allowed to claim from.
 * When `fallback` is set, no component beat a naive constant forecast out of
 * sample and the weights are a shrunk prior — which is the opposite of
 * "measured explanatory power".
 */
export type PrismWeightEvidence = {
  method?: string | null;
  reason?: string | null;
  fallback?: string | null;
  fallback_note?: string | null;
  /** Components that were never scored at all — pure prior. */
  prior_only_components?: string[] | null;
  /** Share of the total weight that was never measured. */
  unscored_prior_mass?: Num;
  components?: Record<string, unknown> | null;
} & { [extra: string]: unknown };

/**
 * How one component's raw forecast became the number the mixture used.
 *
 * The recalibrated engine no longer feeds a component's own expected return
 * straight into the mixture: it shrinks it toward a market prior by
 * `shrink_weight` and then clamps the result into `clamp_bounds`. Both halves
 * are shown on the card, because "seasonality says +90% over 12 months" and
 * "the mixture used +9%" are very different claims and only the second one is
 * in the forecast.
 *
 * Every field is `unknown` rather than `number`: the engine may report these
 * per horizon (`{ "1m": 0.01, … }`) or as a single scalar, and the readers in
 * `src/prism/scenario.ts` accept either. Nothing here is required — a packet
 * built before the recalibration simply has no `shrinkage` block.
 */
export type PrismShrinkage = {
  /** The component's own forecast, before shrinkage. */
  raw_expected_return?: unknown;
  /** The prior it was pulled toward. */
  prior?: unknown;
  /** How much of the prior was mixed in, in `[0,1]`. */
  shrink_weight?: unknown;
  /** What the mixture actually used. */
  expected_return?: unknown;
} & { [extra: string]: unknown };

/** One forecasting component's contribution, as the engine audited it. */
export type PrismScenarioComponent = {
  component?: string | null;
  available?: boolean | null;
  reason?: string | null;
  confidence?: Num;
  basis?: string | null;
  /** Per-horizon record on every packet seen so far; typed loosely on purpose. */
  expected_return?: unknown;
  sigma?: unknown;
  shrinkage?: PrismShrinkage | null;
  /** `[lo, hi]` or `{ low, high }`, flat or keyed by horizon. */
  clamp_bounds?: unknown;
} & { [extra: string]: unknown };

export type PrismScenarios = {
  method?: string | null;
  weights?: Record<string, Num> | null;
  weight_evidence?: PrismWeightEvidence | null;
  /** Per-component audit: what each one forecast and how it was shrunk. */
  components?: Record<string, PrismScenarioComponent | null> | null;
  effective_weights?: Record<string, Num> | null;
  unavailable_components?: string[] | null;
  /** The horizon the case probabilities are quoted at. */
  probability_horizon?: string | null;
  current_price?: Num;
  cases?: Partial<Record<PrismScenarioCaseKey, PrismScenarioCase | null>> | null;
  distribution?: Partial<Record<PrismHorizonKey, PrismDistributionMoments | null>> | null;
  entry?: PrismEntryZone | null;
  timing?: { this_month?: string | null; reason?: string | null } | null;
  watch_signals?: PrismWatchSignal[] | null;
};

// -------- memo --------

export type PrismRecommendationAction = "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
export type PrismRecommendationStrength = "strong" | "normal" | "weak";

export type PrismRecommendation = {
  action: PrismRecommendationAction;
  strength: PrismRecommendationStrength;
  conviction: number;
  one_line: string;
};

export type PrismExitTarget = {
  horizon?: string | null;
  price?: Num;
  /**
   * The *bull case's* probability at this horizon — not the probability of the
   * price being reached. The engine copies it off the bull block it took
   * `price_p50` from (`app/prism/memo.py::derive_targets`) and states as much
   * in `basis`; the UI must never relabel it as odds on the target.
   */
  probability?: Num;
  /** The engine's own words for what `price` is, e.g. "bull-case median price at this horizon". */
  basis?: string | null;
};

export type PrismKeyDeterminant = {
  name: string;
  explanation: string;
  direction?: string | null;
  weight?: Num;
};

export type PrismCitation = {
  id: string;
  claim?: string | null;
  source?: string | null;
  url?: string | null;
};

export type PrismMemo = {
  recommendation?: PrismRecommendation | null;
  entry_price?: Num;
  exit_targets?: PrismExitTarget[] | null;
  stop_or_reassess?: Num;
  text?: string | null;
  key_determinants?: PrismKeyDeterminant[] | null;
  priced_in?: string[] | null;
  citations?: PrismCitation[] | null;
  model?: string | null;
  generated_at?: string | null;
};

// -------- packet --------

export type PrismSourceRef = {
  provider: string;
  /** `null` for a provider row that is an API call rather than a document. */
  url?: string | null;
  fetched_at?: string | null;
  /** The engine scores most rows numerically (0..1) and labels the rest. */
  confidence?: string | number | null;
};

export type PrismMetaError = { source: string; error: string };

export type PrismMeta = {
  errors?: PrismMetaError[] | null;
  source_status?: Record<string, unknown> | null;
  timings_ms?: Record<string, number> | null;
  cache?: Record<string, string> | null;
};

/**
 * Every analytical section is nullable. The `*_error` siblings explain a null
 * — `sectionError()` below is the only thing that should read them.
 */
export type PrismPacket = {
  ticker: string;
  as_of: string;
  generated_at: string;
  engine_version?: string | null;
  name?: string | null;
  profile: PrismProfile | null;
  universe?: PrismUniverseEntry[] | null;
  seasonality: PrismSeasonality | null;
  macro: PrismMacro | null;
  relational: PrismRelational | null;
  factors: PrismFactors | null;
  regimes: PrismRegimes | null;
  entropy: PrismEntropy | null;
  spectral: PrismSpectral | null;
  eigen: PrismEigen | null;
  fundamentals: PrismFundamentals | null;
  filings: PrismFilings | null;
  volatility: PrismVolatility | null;
  levels: PrismLevels | null;
  news: PrismNews | null;
  recent: PrismRecent | null;
  scenarios: PrismScenarios | null;
  memo: PrismMemo | null;
  sources?: PrismSourceRef[] | null;
  meta?: PrismMeta | null;
} & { [extra: string]: unknown };

/** Section keys that can be `null` with a `<key>_error` sibling. */
export type PrismSectionKey =
  | "profile"
  | "seasonality"
  | "macro"
  | "relational"
  | "factors"
  | "regimes"
  | "entropy"
  | "spectral"
  | "eigen"
  | "fundamentals"
  | "filings"
  | "volatility"
  | "levels"
  | "news"
  | "recent"
  | "scenarios"
  | "memo";

/**
 * The bounded agent projection from `GET /v1/prism/:ticker/summary`.
 *
 * Note the shape: the engine does not send a single `text` blob — the prose is
 * `memo_excerpt` (first 1500 chars of the memo) and `one_line` is the thesis.
 * Everything else is a compressed slice of the packet. Fields are optional and
 * nullable because the projection mirrors whatever the packet actually has.
 */
export type PrismSummary = {
  ticker: string;
  as_of?: string | null;
  generated_at?: string | null;
  engine_version?: string | null;
  name?: string | null;
  sector?: string | null;
  industry?: string | null;
  recommendation?: PrismRecommendation | null;
  one_line?: string | null;
  entry_price?: Num;
  fair_value?: Num;
  stop_or_reassess?: Num;
  exit_targets?: PrismExitTarget[] | null;
  key_determinants?: PrismKeyDeterminant[] | null;
  priced_in?: string[] | null;
  memo_excerpt?: string | null;
  /** Section keys that are `null` in the packet behind this projection. */
  unavailable_sections?: string[] | null;
  errors?: PrismMetaError[] | null;
  disclaimer?: string | null;
  /** Reserved: the engine may start pre-rendering its own prose here. */
  text?: string | null;
} & { [extra: string]: unknown };

export type PrismChatMessage = { role: "user" | "assistant"; content: string };

export type PrismChatResponse = {
  ticker: string;
  reply: string;
  conversationId?: string | null;
  citations?: PrismCitation[] | null;
  /** `null` when the engine answered from the stored memo (no model configured). */
  model?: string | null;
  generatedAt?: string | null;
} & { [extra: string]: unknown };

// -------- requests --------

export type PrismFetchOpts = { token?: string; signal?: AbortSignal };

/** Uppercase + strip a leading `$`; empty string when nothing usable is left. */
export function normalizeTicker(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/^\$+/, "").toUpperCase().slice(0, 16);
}

/**
 * Build (or rebuild) a packet. Metered as a `memo` generation and slow — a cold
 * run is 1–3 minutes, so callers should render staged progress and may poll
 * {@link getPrismPacket} instead of waiting on this promise.
 */
export function buildPrismPacket(
  ticker: string,
  args: { force?: boolean; includeMemo?: boolean } = {},
  opts: PrismFetchOpts = {},
): Promise<PrismPacket> {
  return apiFetch<PrismPacket>(
    "/v1/prism",
    {
      method: "POST",
      body: JSON.stringify({
        ticker: normalizeTicker(ticker),
        ...(args.force === undefined ? {} : { force: args.force }),
        ...(args.includeMemo === undefined ? {} : { includeMemo: args.includeMemo }),
      }),
    },
    opts,
  );
}

/** Latest stored packet. Throws `ApiError(404, code: "prism_packet_not_found")` when none exists. */
export function getPrismPacket(ticker: string, opts: PrismFetchOpts = {}): Promise<PrismPacket> {
  return apiFetch<PrismPacket>(
    `/v1/prism/${encodeURIComponent(normalizeTicker(ticker))}`,
    { method: "GET" },
    opts,
  );
}

/** The bounded agent projection — what Research injects as context. */
export function getPrismSummary(ticker: string, opts: PrismFetchOpts = {}): Promise<PrismSummary> {
  return apiFetch<PrismSummary>(
    `/v1/prism/${encodeURIComponent(normalizeTicker(ticker))}/summary`,
    { method: "GET" },
    opts,
  );
}

/** Ask the stored packet a question. The engine answers only from the packet. */
export function prismChat(
  args: {
    ticker: string;
    message: string;
    conversationId?: string;
    history?: PrismChatMessage[];
  },
  opts: PrismFetchOpts = {},
): Promise<PrismChatResponse> {
  return apiFetch<PrismChatResponse>(
    "/v1/prism/chat",
    {
      method: "POST",
      body: JSON.stringify({
        ticker: normalizeTicker(args.ticker),
        message: args.message,
        ...(args.conversationId ? { conversationId: args.conversationId } : {}),
        ...(args.history?.length ? { history: args.history.slice(-20) } : {}),
      }),
    },
    opts,
  );
}

/** Absolute URL for the export route — `expo-file-system` downloads it directly. */
export function prismExportUrl(ticker: string, format: PrismExportFormat): string {
  return `${API_URL}/v1/prism/${encodeURIComponent(normalizeTicker(ticker))}/export?format=${format}`;
}

/**
 * Local cache filename for a downloaded export, and the name the share sheet
 * offers. Deliberately our own rather than the server's: the engine's
 * `Content-Disposition` carries the packet date too (`prism-NVDA-2026-09-01.txt`)
 * and `expo-file-system` writes to the path we give it regardless, so this stays
 * the stable per-ticker name that a re-download overwrites instead of piling up
 * one file per build. Uppercase to match the ticker as it is shown on screen.
 */
export function prismExportFilename(ticker: string, format: PrismExportFormat): string {
  return `prism-${normalizeTicker(ticker) || "packet"}.${format}`;
}

export const PRISM_EXPORT_MIME: Readonly<Record<PrismExportFormat, string>> = {
  txt: "text/plain",
  json: "application/json",
  pdf: "application/pdf",
};

export const PRISM_EXPORT_UTI: Readonly<Record<PrismExportFormat, string>> = {
  txt: "public.plain-text",
  json: "public.json",
  pdf: "com.adobe.pdf",
};

// -------- error helpers --------

/** A 404 from the read route means "never built", which is a UI state, not a failure. */
export function isPacketMissing(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** The engine bounds its own concurrency and answers 429/503 while busy. */
export function isEngineBusy(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 429 || err.status === 503);
}

/**
 * Human copy for a Prism failure. Upstream transport detail (engine 5xx codes,
 * provider names) never reaches the screen — the same posture as
 * `formatChartError` in `./underlying`.
 */
export function formatPrismError(err: unknown): string {
  if (isPacketMissing(err)) return "No Prism packet for this ticker yet.";
  if (isEngineBusy(err)) return "Prism is busy right now. Try again in a moment.";
  if (err instanceof ApiError) {
    if (err.isQuotaExceeded) return "Free generations used. Subscribe to keep building packets.";
    if (err.status === 400) return "That ticker isn’t something Prism can build.";
    if (err.status === 504)
      return "Prism took too long. The build may still finish — pull to refresh.";
    if (err.status >= 500) return "Prism is unavailable right now. Try again.";
  }
  const message = err instanceof Error ? err.message : "";
  if (/network|offline|fetch failed|failed to fetch|connection/i.test(message)) {
    return "Couldn’t reach Prism. Check your connection and try again.";
  }
  return "Prism couldn’t finish. Try again.";
}
