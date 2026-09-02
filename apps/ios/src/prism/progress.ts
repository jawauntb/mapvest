/**
 * Staged progress copy for a Prism build.
 *
 * `POST /v1/prism` runs the whole engine and takes 1–3 minutes, so the screen
 * cannot show a spinner and hope. These stages are *elapsed-time* copy, not
 * server telemetry — the engine does not stream progress — so they describe
 * the work in the order the engine does it and never claim a stage is done.
 * The bar is deliberately capped below 100%: it fills toward the typical
 * finish, and only a delivered packet ends it.
 */

export type BuildStage = {
  key: string;
  /** Headline, present tense. */
  label: string;
  /** One line naming the actual work, so the wait is legible. */
  detail: string;
  /** 0..1, monotonic, capped at 0.96 — only a packet finishes the bar. */
  progress: number;
};

type StageSpec = Omit<BuildStage, "progress"> & { atMs: number };

/** Typical cold build. The API's own upstream budget is 180s. */
export const PRISM_BUILD_BUDGET_MS = 180_000;

const STAGES: readonly StageSpec[] = [
  {
    atMs: 0,
    key: "universe",
    label: "Resolving the universe",
    detail: "Ten years of daily bars for the ticker, its sector ETFs, credit, FX, and crypto.",
  },
  {
    atMs: 20_000,
    key: "macro",
    label: "Pulling macro series",
    detail: "FRED yields, VIX, the dollar, crude, high-yield spreads, and payrolls.",
  },
  {
    atMs: 45_000,
    key: "quant",
    label: "Fitting regimes, factors, and cycles",
    detail: "Three-state HMM on SPY, factor betas, spectral modes, entropy windows.",
  },
  {
    atMs: 80_000,
    key: "filings",
    label: "Reading filings and news",
    detail: "The last two 10-Ks and three 10-Qs, then the news and policy sweep.",
  },
  {
    atMs: 115_000,
    key: "scenarios",
    label: "Weighing scenarios",
    detail: "Walk-forward weights across seasonality, regime, factor, spectral, and macro.",
  },
  {
    atMs: 145_000,
    key: "memo",
    label: "Writing the memo",
    detail: "Recommendation, entry zone, exit targets, and citations back to the packet.",
  },
  {
    atMs: 185_000,
    key: "overtime",
    label: "Still working",
    detail: "Cold caches make this slow. The packet is stored when it lands and shows up here.",
  },
] as const;

export const PRISM_BUILD_STAGES: readonly Omit<BuildStage, "progress">[] = STAGES.map(
  ({ atMs: _atMs, ...rest }) => rest,
);

/** The stage copy for a given elapsed time, plus a determinate progress fraction. */
export function buildStage(elapsedMs: number): BuildStage {
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  let current: StageSpec = STAGES[0] as StageSpec;
  for (const stage of STAGES) {
    if (elapsed >= stage.atMs) current = stage;
  }
  const { atMs: _atMs, ...rest } = current;
  return {
    ...rest,
    progress: Math.min(0.96, elapsed / PRISM_BUILD_BUDGET_MS),
  };
}

/** Index of the stage currently running — the progress list highlights it. */
export function stageIndex(elapsedMs: number): number {
  const key = buildStage(elapsedMs).key;
  return STAGES.findIndex((s) => s.key === key);
}

/** `74_000 → "1:14"`. */
export function fmtElapsed(elapsedMs: number): string {
  const secs = Math.max(0, Math.floor((Number.isFinite(elapsedMs) ? elapsedMs : 0) / 1000));
  const mins = Math.floor(secs / 60);
  return `${mins}:${String(secs % 60).padStart(2, "0")}`;
}
