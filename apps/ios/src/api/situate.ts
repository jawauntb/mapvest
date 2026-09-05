/**
 * Typed client for Situate — the single-name research engine that reforms
 * Prism, proxied by the Mapvest API at `/v1/situate/*` (alias `/v1/research/*`).
 *
 *   POST /v1/situate                        build a packet (1–3 minutes, metered)
 *   GET  /v1/situate/:ticker                latest stored packet (404 = none yet)
 *   GET  /v1/situate/:ticker/summary        bounded agent projection
 *   POST /v1/situate/chat                   ask the packet a question
 *   GET  /v1/situate/:ticker/export?format= txt | json | pdf bytes
 *
 * The types below mirror the packet contract the engine publishes and the zod
 * schemas in `packages/core` (`SituatePacket`). Two rules are load-bearing for
 * every renderer in `src/situate`:
 *
 *   1. Every analytical section is always present but may be `null`. `null`
 *      means "could not compute", never "zero" — and a sibling
 *      `<section>_error` string says why. Never render a null as a 0.
 *   2. Percent returns are decimal fractions (0.034 = 3.4%). Dates are ISO. The
 *      call is a POSTURE, never buy/sell, never a point price target.
 *
 * Sections are typed optimistically: every field is optional/nullable so a
 * packet from an older or newer engine still parses into something renderable.
 * Unknown keys survive (we cast the JSON rather than stripping it).
 */
import { API_URL } from "@/util/env";
import { ApiError } from "./errors";
import { apiFetch } from "./http";

export { ApiError } from "./errors";

// Re-exported from `src/situate/constants.ts` so the pure helpers (and their
// bun tests) can read the vocabulary without importing this module's fetch
// stack.
export {
  SITUATE_EXPORT_FORMATS,
  SITUATE_HORIZON_MONTHS,
  SITUATE_HORIZONS,
  SITUATE_DEFAULT_HORIZON,
} from "@/situate/constants";
export type {
  SituateExportFormat,
  SituateHorizonKey,
  SituateStance,
} from "@/situate/constants";

import type { SituateExportFormat } from "@/situate/constants";

type Num = number | null;

// -------- profile --------

export type SituateProfile = {
  name?: string | null;
  sector?: string | null;
  industry?: string | null;
  market_cap?: Num;
  description?: string | null;
  listed_since?: string | null;
  related_etfs?: string[] | null;
};

// -------- exposure (SPEC 5.1) --------

export type SituateFactorView = {
  alpha_annual?: Num;
  loadings?: Record<string, Num> | null;
  t_stats?: Record<string, Num> | null;
  r2?: Num;
};

export type SituateBetaPathPoint = { date: string; beta?: Num };

export type SituateExposure = {
  basket?: string[] | null;
  betas?: Record<string, Num> | null;
  se?: Record<string, Num> | null;
  r2?: Num;
  idiosyncratic_share?: Num;
  residual_vol_annual?: Num;
  factor?: SituateFactorView | null;
  beta_path?: Record<string, SituateBetaPathPoint[] | null> | null;
  change_6m?: Record<string, Num> | null;
  change_12m?: Record<string, Num> | null;
  method?: string | null;
};

// -------- state (SPEC 5.2) --------

export type SituateStateCell = {
  vol_state?: string | null;
  trend_state?: string | null;
  cell?: string | null;
  realized_vol_21d?: Num;
  vol_median_2y?: Num;
  ret_12m_1m?: Num;
};

export type SituateHmm = {
  probs?: { bull?: Num; neutral?: Num; bear?: Num } | null;
  label?: string | null;
};

export type SituateStateContext = {
  vix_pct?: Num;
  hy_oas_pct?: Num;
  curve_10y_2y?: Num;
};

export type SituateState = {
  spy?: SituateStateCell | null;
  ticker?: SituateStateCell | null;
  hmm?: SituateHmm | null;
  context?: SituateStateContext | null;
};

// -------- base_rates (SPEC 5.3) --------

export type SituateBaseRateDist = {
  q05?: Num;
  q25?: Num;
  q50?: Num;
  q75?: Num;
  q95?: Num;
  hit?: Num;
  n_eff?: Num;
  cell?: string | null;
  w?: Num;
};

export type SituateBaseRateHorizon = {
  uncond?: SituateBaseRateDist | null;
  cond?: SituateBaseRateDist | null;
  shrunk?: SituateBaseRateDist | null;
  vol_managed?: SituateBaseRateDist | null;
  industry?: {
    uncond?: SituateBaseRateDist | null;
    cond?: SituateBaseRateDist | null;
    shrunk?: SituateBaseRateDist | null;
  } | null;
};

export type SituateBaseRates = {
  by_horizon?: Record<string, SituateBaseRateHorizon | null> | null;
};

// -------- implied (SPEC 5.4) --------

export type SituateRnDensityPoint = { k?: Num; pdf?: Num };

export type SituateImpliedHorizon = {
  expiry?: string | null;
  iv_atm?: Num;
  skew_25d?: Num;
  quantiles?: { q05?: Num; q25?: Num; q50?: Num; q75?: Num; q95?: Num } | null;
  p_up10?: Num;
  p_dn10?: Num;
  p_up20?: Num;
  p_dn20?: Num;
  width_ratio_vs_hist?: Num;
  rn_density?: SituateRnDensityPoint[] | null;
};

export type SituateImplied = {
  snapshot_ts?: string | null;
  by_horizon?: Record<string, SituateImpliedHorizon | null> | null;
};

// -------- fundamentals (SPEC 5.5) --------

export type SituateTrajectoryQuarter = {
  period_end?: string | null;
  filing_date?: string | null;
  rev_growth?: Num;
  gross_margin?: Num;
  op_margin?: Num;
  fcf_margin?: Num;
  capex_to_rev?: Num;
};

export type SituateFundamentals = {
  momentum?: { ret_12_1?: Num; ret_1m_reversal?: Num } | null;
  quality?: {
    gp_to_assets?: Num;
    accruals?: Num;
    net_debt_ebitda?: Num;
    interest_cov?: Num;
  } | null;
  value_z?: {
    ev_sales?: Num;
    ev_ebitda?: Num;
    pe_fwd?: Num;
    fcf_yield?: Num;
    basis?: string | null;
  } | null;
  trajectory?: SituateTrajectoryQuarter[] | null;
  trajectory_flags?: { rev_accel?: boolean | null; margin_accel?: boolean | null } | null;
  /** Unavailable — Massive has no estimates endpoint. Stated, never faked. */
  revisions?: unknown;
  pead?: unknown;
  revisions_error?: string | null;
  pead_error?: string | null;
};

// -------- text (SPEC 5.6) --------

export type SituateRiskQuote = { text?: string | null; quote?: string | null };

export type SituateFilingChange = {
  section?: string | null;
  change_score?: Num;
  new_risks?: SituateRiskQuote[] | null;
  removed_risks?: SituateRiskQuote[] | null;
  concentration_change?: string | null;
  capex_change?: string | null;
  guidance_tone_change?: string | null;
  material_change_score?: Num;
};

export type SituateEvent = {
  date?: string | null;
  type?: string | null;
  sentiment?: string | null;
  headline?: string | null;
  url?: string | null;
};

export type SituateText = {
  filing_changes?: SituateFilingChange[] | null;
  events?: SituateEvent[] | null;
  exposure_flags?: string[] | null;
};

// -------- levels (SPEC 5.8) --------

export type SituateZone = {
  price_lo?: Num;
  price_hi?: Num;
  horizon?: string | null;
};

export type SituateLevels = {
  poc?: Num;
  vah?: Num;
  val?: Num;
  ma20?: Num;
  ma50?: Num;
  ma200?: Num;
  dist_to_ma?: Record<string, Num> | null;
  current_price?: Num;
  cheap_zone?: SituateZone | null;
  rich_zone?: SituateZone | null;
};

// -------- stack (SPEC 5.7) --------

export type SituateStackHorizon = {
  expected_excess?: Num;
  quantiles?: { q05?: Num; q25?: Num; q50?: Num; q75?: Num; q95?: Num } | null;
  feature_contributions?: Record<string, Num> | null;
  oos_ic?: Num;
  deflated_sharpe?: Num;
  passed_gates?: boolean | null;
};

export type SituateStack = {
  published?: boolean | null;
  reason?: string | null;
  by_horizon?: Record<string, SituateStackHorizon | null> | null;
  features?: string[] | null;
  configs_tried?: Num;
};

// -------- odds (merged distribution the memo reads) --------

export type SituateOddsHorizon = {
  source?: "stack" | "base_rates+implied" | string | null;
  quantiles?: { q05?: Num; q25?: Num; q50?: Num; q75?: Num; q95?: Num } | null;
  p_up?: Num;
  base_rate_q50?: Num;
  implied_q50?: Num;
  shrink_w?: Num;
};

/**
 * The engine wraps the merged distribution as
 * `{version, method, stack_published, by_horizon:{...}}` — the same shape as
 * base_rates/implied/stack. Read horizons through `by_horizon`.
 */
export type SituateOdds = {
  version?: string | null;
  method?: string | null;
  stack_published?: boolean | null;
  by_horizon?: Record<string, SituateOddsHorizon | null> | null;
};

// -------- scenarios --------

export type SituateScenarioHorizon = { quantile?: Num; drivers?: string[] | null };

export type SituateScenarioCase = {
  state?: string | null;
  horizons?: Record<string, SituateScenarioHorizon | null> | null;
};

export type SituateScenarios = {
  bull?: SituateScenarioCase | null;
  neutral?: SituateScenarioCase | null;
  bear?: SituateScenarioCase | null;
};

// -------- memo --------

export type SituatePosture = {
  stance: "odds_favorable" | "balanced" | "odds_unfavorable";
  /** The engine emits this as a bare integer of months (6); format with `postureHorizon`. */
  horizon: string | number;
  conviction: number;
  one_line: string;
};

export type SituateKeyDeterminant = {
  name: string;
  explanation: string;
  direction?: string | null;
};

export type SituateCitation = {
  id: string;
  claim?: string | null;
  module?: string | null;
  version?: string | null;
  url?: string | null;
};

export type SituateMemo = {
  posture?: SituatePosture | null;
  text?: string | null;
  falsifiers?: string[] | null;
  key_determinants?: SituateKeyDeterminant[] | null;
  whats_priced_in?: string[] | null;
  citations?: SituateCitation[] | null;
  zones?: { cheap?: SituateZone | null; rich?: SituateZone | null } | null;
  model?: string | null;
  generated_at?: string | null;
};

// -------- packet --------

export type SituateSourceRef = {
  provider: string;
  url?: string | null;
  fetched_at?: string | null;
  confidence?: string | number | null;
};

export type SituateMetaError = { source: string; error: string };

export type SituateMeta = {
  errors?: SituateMetaError[] | null;
  unavailable?: Record<string, unknown>[] | null;
  source_status?: Record<string, unknown> | null;
  timings_ms?: Record<string, number> | null;
  versions?: Record<string, string> | null;
  cache?: Record<string, string | number> | null;
};

/**
 * Every analytical section is nullable. The `*_error` siblings explain a null
 * — `sectionUnavailable()` in signals.ts is the only thing that should read
 * them.
 */
export type SituatePacket = {
  ticker: string;
  as_of: string;
  generated_at: string;
  engine?: string | null;
  engine_version?: string | null;
  profile: SituateProfile | null;
  exposure: SituateExposure | null;
  state: SituateState | null;
  base_rates: SituateBaseRates | null;
  implied: SituateImplied | null;
  fundamentals: SituateFundamentals | null;
  text: SituateText | null;
  levels: SituateLevels | null;
  stack: SituateStack | null;
  odds: SituateOdds | null;
  scenarios: SituateScenarios | null;
  memo: SituateMemo | null;
  sources?: SituateSourceRef[] | null;
  meta?: SituateMeta | null;
} & { [extra: string]: unknown };

/** Section keys that can be `null` with a `<key>_error` sibling. */
export type SituateSectionKey =
  | "profile"
  | "exposure"
  | "state"
  | "base_rates"
  | "implied"
  | "fundamentals"
  | "text"
  | "levels"
  | "stack"
  | "odds"
  | "scenarios"
  | "memo";

/** The bounded agent projection from `GET /v1/situate/:ticker/summary`. */
export type SituateSummary = {
  ticker: string;
  as_of?: string | null;
  generated_at?: string | null;
  engine_version?: string | null;
  name?: string | null;
  sector?: string | null;
  industry?: string | null;
  posture?: SituatePosture | null;
  one_line?: string | null;
  memo_excerpt?: string | null;
  unavailable_sections?: string[] | null;
  errors?: SituateMetaError[] | null;
  disclaimer?: string | null;
  text?: string | null;
} & { [extra: string]: unknown };

export type SituateChatMessage = { role: "user" | "assistant"; content: string };

export type SituateChatResponse = {
  ticker: string;
  reply: string;
  conversationId?: string | null;
  citations?: SituateCitation[] | null;
  model?: string | null;
  generatedAt?: string | null;
} & { [extra: string]: unknown };

// -------- requests --------

export type SituateFetchOpts = { token?: string; signal?: AbortSignal };

/** Uppercase + strip a leading `$`; empty string when nothing usable is left. */
export function normalizeTicker(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/^\$+/, "").toUpperCase().slice(0, 16);
}

/**
 * Build (or rebuild) a packet. Metered as a `memo` generation and slow — a cold
 * run is 1–3 minutes, so callers should render staged progress and may poll
 * {@link getSituatePacket} instead of waiting on this promise.
 */
export function buildSituatePacket(
  ticker: string,
  args: { force?: boolean; includeMemo?: boolean; asOf?: string } = {},
  opts: SituateFetchOpts = {},
): Promise<SituatePacket> {
  return apiFetch<SituatePacket>(
    "/v1/situate",
    {
      method: "POST",
      body: JSON.stringify({
        ticker: normalizeTicker(ticker),
        ...(args.force === undefined ? {} : { force: args.force }),
        ...(args.includeMemo === undefined ? {} : { includeMemo: args.includeMemo }),
        ...(args.asOf === undefined ? {} : { asOf: args.asOf }),
      }),
    },
    opts,
  );
}

/** Latest stored packet. Throws `ApiError(404, code: "situate_packet_not_found")` when none. */
export function getSituatePacket(
  ticker: string,
  opts: SituateFetchOpts = {},
): Promise<SituatePacket> {
  return apiFetch<SituatePacket>(
    `/v1/situate/${encodeURIComponent(normalizeTicker(ticker))}`,
    { method: "GET" },
    opts,
  );
}

/** The bounded agent projection — what Research injects as context. */
export function getSituateSummary(
  ticker: string,
  opts: SituateFetchOpts = {},
): Promise<SituateSummary> {
  return apiFetch<SituateSummary>(
    `/v1/situate/${encodeURIComponent(normalizeTicker(ticker))}/summary`,
    { method: "GET" },
    opts,
  );
}

/** Ask the stored packet a question. The engine answers only from the packet. */
export function situateChat(
  args: {
    ticker: string;
    message: string;
    conversationId?: string;
    history?: SituateChatMessage[];
  },
  opts: SituateFetchOpts = {},
): Promise<SituateChatResponse> {
  return apiFetch<SituateChatResponse>(
    "/v1/situate/chat",
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
export function situateExportUrl(ticker: string, format: SituateExportFormat): string {
  return `${API_URL}/v1/situate/${encodeURIComponent(normalizeTicker(ticker))}/export?format=${format}`;
}

/** Local cache filename for a downloaded export, and the name the share sheet offers. */
export function situateExportFilename(ticker: string, format: SituateExportFormat): string {
  return `situate-${normalizeTicker(ticker) || "packet"}.${format}`;
}

export const SITUATE_EXPORT_MIME: Readonly<Record<SituateExportFormat, string>> = {
  txt: "text/plain",
  json: "application/json",
  pdf: "application/pdf",
};

export const SITUATE_EXPORT_UTI: Readonly<Record<SituateExportFormat, string>> = {
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

/** Human copy for a Situate failure. Upstream transport detail never reaches the screen. */
export function formatSituateError(err: unknown): string {
  if (isPacketMissing(err)) return "No Situate packet for this ticker yet.";
  if (isEngineBusy(err)) return "Situate is busy right now. Try again in a moment.";
  if (err instanceof ApiError) {
    if (err.isQuotaExceeded) return "Free generations used. Subscribe to keep building packets.";
    if (err.status === 400) return "That ticker isn’t something Situate can build.";
    if (err.status === 504)
      return "Situate took too long. The build may still finish — pull to refresh.";
    if (err.status >= 500) return "Situate is unavailable right now. Try again.";
  }
  const message = err instanceof Error ? err.message : "";
  if (/network|offline|fetch failed|failed to fetch|connection/i.test(message)) {
    return "Couldn’t reach Situate. Check your connection and try again.";
  }
  return "Situate couldn’t finish. Try again.";
}
