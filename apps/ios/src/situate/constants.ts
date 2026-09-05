/**
 * Situate vocabulary constants.
 *
 * Kept in their own module — with zero imports — so the pure helpers in
 * `src/situate` (and their bun tests) can use them without pulling in the API
 * client, which reaches for SecureStore at import time. `src/api/situate.ts`
 * re-exports everything here, so callers only ever need one import.
 *
 * Situate REFORMS Prism: the horizons are the SPEC's month set {1,2,3,6,12,18},
 * keyed in the packet's `by_horizon` blocks by their month number as a string
 * ("1", "2", … "18"). The helpers accept the "1m" spelling too, defensively.
 */

/** Horizon keys as the engine emits them — month numbers as strings. */
export type SituateHorizonKey = "1" | "2" | "3" | "6" | "12" | "18";

/** Shortest first — the order every horizon strip renders in. */
export const SITUATE_HORIZONS: readonly SituateHorizonKey[] = ["1", "2", "3", "6", "12", "18"];

/** Months per horizon, used for honest x-spacing on the fan chart. */
export const SITUATE_HORIZON_MONTHS: Readonly<Record<SituateHorizonKey, number>> = {
  "1": 1,
  "2": 2,
  "3": 3,
  "6": 6,
  "12": 12,
  "18": 18,
};

/** The horizon the posture is quoted at when the memo does not name one. */
export const SITUATE_DEFAULT_HORIZON: SituateHorizonKey = "3";

export type SituateStance = "odds_favorable" | "balanced" | "odds_unfavorable";

export type SituateExportFormat = "txt" | "json" | "pdf";
export const SITUATE_EXPORT_FORMATS: readonly SituateExportFormat[] = ["txt", "json", "pdf"];

/**
 * Muted text that still clears WCAG AA at 10–13px on the sunken/elevated
 * grounds. Same value as `chartkit/situate/theme.ts`'s `chart.dim` and the
 * sibling `PRISM_DIM` — they solve the same axis-label contrast problem.
 */
export const SITUATE_DIM = "#7F8892";

/**
 * How old a packet may be before the screen warns that its prices are stale.
 * A packet is built at most once a day and pins the session close it was built
 * from, so three days is the point where a large unqualified price stops being
 * defensible.
 */
export const SITUATE_STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
