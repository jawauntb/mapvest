/**
 * Prism vocabulary constants.
 *
 * Kept in their own module — with zero imports — so the pure helpers in
 * `src/prism` (and their bun tests) can use them without pulling in the API
 * client, which reaches for SecureStore at import time. `src/api/prism.ts`
 * re-exports everything here, so callers only ever need one import.
 */

export type PrismHorizonKey = "1m" | "2m" | "3m" | "6m" | "12m" | "18m";

/** Shortest first — the order every horizon strip renders in. */
export const PRISM_HORIZONS: readonly PrismHorizonKey[] = ["1m", "2m", "3m", "6m", "12m", "18m"];

/** Months per horizon, used for honest x-spacing on the fan chart. */
export const PRISM_HORIZON_MONTHS: Readonly<Record<PrismHorizonKey, number>> = {
  "1m": 1,
  "2m": 2,
  "3m": 3,
  "6m": 6,
  "12m": 12,
  "18m": 18,
};

export type PrismSeasonWindow = "1y" | "2y" | "5y" | "10y";
export const PRISM_SEASON_WINDOWS: readonly PrismSeasonWindow[] = ["1y", "2y", "5y", "10y"];

export type PrismRelWindow = "3m" | "6m" | "1y" | "2y" | "5y" | "10y";
export const PRISM_REL_WINDOWS: readonly PrismRelWindow[] = ["3m", "6m", "1y", "2y", "5y", "10y"];

export type PrismRegimeLabel = "bull" | "bear" | "neutral";

export type PrismScenarioCaseKey = "bull" | "neutral" | "bear";
export const SCENARIO_CASES: readonly PrismScenarioCaseKey[] = ["bull", "neutral", "bear"];

export type PrismExportFormat = "txt" | "json" | "pdf";
export const PRISM_EXPORT_FORMATS: readonly PrismExportFormat[] = ["txt", "json", "pdf"];

/**
 * Muted text that still clears WCAG AA at 10–13px.
 *
 * `colors.fgDim` (#6E7883) is 3.89:1 on `bgElevated` and 4.44:1 on `bgSunken`
 * — both under the 4.5:1 floor for text below 18pt. This sits at 4.91:1 and
 * 5.60:1 respectively while still reading a clear step quieter than
 * `colors.fgMuted`. Same value as `chartkit/prism/theme.ts`'s `chart.dim`,
 * which solved the same problem for axis labels.
 */
export const PRISM_DIM = "#7F8892";

/**
 * How old a packet may be before the screen warns that its prices are stale.
 * A packet is built at most once a day and pins the session close it was built
 * from, so three days is the point where a large unqualified price on the hero
 * stops being defensible.
 */
export const PRISM_STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
