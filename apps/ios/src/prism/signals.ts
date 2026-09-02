import type {
  PrismEntropyWindow,
  PrismFactors,
  PrismLevels,
  PrismMacro,
  PrismMacroSeries,
  PrismQuarter,
  PrismRegimeLabel,
  PrismRegimeState,
  PrismRegimes,
  PrismRelWindow,
  PrismRelational,
  PrismSeasonWindow,
  PrismSeasonality,
  PrismSpectralMode,
  PrismVolatility,
} from "@/api/prism";
/**
 * Packet → chart-ready rows. Pure and unit tested; no react-native imports.
 *
 * Each helper answers exactly one question a chart asks ("which regime ran
 * when?", "where on its cycle is each spectral mode?") and returns `null`
 * fields rather than substituting zeros, so a chart can draw a gap where the
 * engine had nothing.
 */
import { PRISM_REL_WINDOWS, PRISM_SEASON_WINDOWS } from "./constants";
import type { Tone } from "./format";

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Narrow an engine-supplied label to the three the ribbon knows how to color. */
function asRegimeLabel(value: unknown): PrismRegimeLabel | null {
  return value === "bull" || value === "bear" || value === "neutral" ? value : null;
}

function toneOfRegime(label: string | null): Tone {
  if (label === "bull") return "bull";
  if (label === "bear") return "bear";
  return "neutral";
}

// -------- regimes --------

export type RegimeRun = {
  label: PrismRegimeLabel | null;
  tone: Tone;
  startDate: string;
  endDate: string;
  /** Number of sampled points in the run (the history is monthly-sampled). */
  points: number;
};

/** Resolve a state id to its label using the packet's own `states` table. */
export function regimeLabelById(
  regimes: PrismRegimes | null | undefined,
  id: number | null,
): PrismRegimeLabel | null {
  if (id === null) return null;
  for (const s of regimes?.states ?? []) {
    if (num(s?.id) === id) return asRegimeLabel(s?.label);
  }
  return null;
}

/** Run-length encode the monthly-sampled state history into ribbon segments. */
export function regimeRuns(regimes: PrismRegimes | null | undefined): RegimeRun[] {
  const history = regimes?.history ?? [];
  const runs: RegimeRun[] = [];
  for (const point of history) {
    if (!point || typeof point.date !== "string") continue;
    const label = asRegimeLabel(point.label) ?? regimeLabelById(regimes, num(point.state));
    const prev = runs[runs.length - 1];
    if (prev && prev.label === label) {
      prev.endDate = point.date;
      prev.points += 1;
      continue;
    }
    runs.push({
      label,
      tone: toneOfRegime(label),
      startDate: point.date,
      endDate: point.date,
      points: 1,
    });
  }
  return runs;
}

export type PosteriorSlice = { label: PrismRegimeLabel | null; tone: Tone; p: number };

/** Current posterior aligned to the `states` table, renormalised to sum to 1. */
export function regimePosterior(regimes: PrismRegimes | null | undefined): PosteriorSlice[] {
  const posterior = regimes?.current?.posterior ?? null;
  if (!posterior || posterior.length === 0) return [];
  const states = regimes?.states ?? [];
  const raw = posterior.map((value, i) => {
    const label = asRegimeLabel(states[i]?.label);
    return { label, tone: toneOfRegime(label), p: Math.max(0, num(value) ?? 0) };
  });
  const total = raw.reduce((acc, r) => acc + r.p, 0);
  if (!(total > 0)) return raw;
  return raw.map((r) => ({ ...r, p: r.p / total }));
}

/**
 * The volatility of a regime state, as a number a reader can use.
 *
 * `states[].volatility` is the HMM's *input feature* — mean squared deviation
 * from the 10-day moving average over the squared moving average — which lands
 * around 1e-5 and renders as "0.0%" under a "vol" label. `vol_feature_mean` is
 * the engine's alias for the same figure. The annualized number is the only one
 * that means what "volatility" means on screen, so this returns that or `null`;
 * it never falls back to the feature.
 */
export function regimeStateVol(state: PrismRegimeState | null | undefined): number | null {
  return num(state?.volatility_annualized);
}

// -------- seasonality --------

export type SeasonalCell = {
  window: PrismSeasonWindow;
  mean: number | null;
  hitRate: number | null;
  n: number | null;
};

export type SeasonalRow = {
  symbol: string;
  isTicker: boolean;
  cells: SeasonalCell[];
  trend: string | null;
};

/**
 * Grid rows: the ticker first, then each benchmark in packet order. Every row
 * carries all four windows so the grid stays rectangular even when a young
 * series has no 10-year history.
 */
export function seasonalityRows(
  seasonality: PrismSeasonality | null | undefined,
  ticker: string,
): SeasonalRow[] {
  const rows: SeasonalRow[] = [];
  const push = (symbol: string, stats: Parameters<typeof cellsOf>[0], isTicker: boolean) => {
    rows.push({
      symbol,
      isTicker,
      cells: cellsOf(stats),
      trend:
        typeof stats?.trend?.direction === "string" && stats.trend.direction.trim()
          ? stats.trend.direction.trim()
          : null,
    });
  };
  if (seasonality?.ticker) push(ticker, seasonality.ticker, true);
  for (const [symbol, stats] of Object.entries(seasonality?.benchmarks ?? {})) {
    if (!stats) continue;
    push(symbol, stats, false);
  }
  return rows;
}

function cellsOf(stats: PrismSeasonality["ticker"]): SeasonalCell[] {
  return PRISM_SEASON_WINDOWS.map((window) => {
    const stat = stats?.this_month?.[window] ?? null;
    return {
      window,
      mean: num(stat?.mean),
      hitRate: num(stat?.hit_rate),
      n: num(stat?.n),
    };
  });
}

// -------- relational --------

export type RelationalRow = {
  symbol: string;
  correlation: Array<{ window: PrismRelWindow; value: number | null }>;
  beta1y: number | null;
  betaTrend: string | null;
  velocity: number | null;
  acceleration: number | null;
  impactWeight: number | null;
};

/**
 * One row per benchmark, ordered by |1-year correlation| so the symbols that
 * actually move with the ticker are at the top of the heatmap.
 */
export function relationalRows(relational: PrismRelational | null | undefined): RelationalRow[] {
  const corr = relational?.correlation ?? {};
  const beta = relational?.beta ?? {};
  const symbols = new Set<string>([...Object.keys(corr ?? {}), ...Object.keys(beta ?? {})]);
  const rows: RelationalRow[] = [];
  for (const symbol of symbols) {
    const c = corr?.[symbol] ?? null;
    const b = beta?.[symbol] ?? null;
    const k = relational?.kinematics?.[symbol] ?? null;
    rows.push({
      symbol,
      correlation: PRISM_REL_WINDOWS.map((window) => ({ window, value: num(c?.[window]) })),
      beta1y: num(b?.["1y"]),
      betaTrend:
        typeof b?.rolling_trend === "string" && b.rolling_trend.trim()
          ? b.rolling_trend.trim()
          : null,
      velocity: num(k?.velocity),
      acceleration: num(k?.acceleration),
      impactWeight: num(relational?.impact_weights?.[symbol]?.weight),
    });
  }
  const strength = (r: RelationalRow) => {
    const oneYear = r.correlation.find((c) => c.window === "1y")?.value;
    return oneYear === null || oneYear === undefined ? -1 : Math.abs(oneYear);
  };
  return rows.sort((a, b2) => strength(b2) - strength(a));
}

// -------- factors --------

/** Canonical Fama-French ordering; anything else the engine adds trails it. */
const FACTOR_ORDER = ["MKT", "SMB", "HML", "RMW", "CMA", "MOM"] as const;

export type FactorRow = { name: string; beta: number | null; t: number | null };

export function factorWindows(factors: PrismFactors | null | undefined): string[] {
  const keys = Object.keys(factors?.windows ?? {});
  const rank = (k: string) => {
    const m = /^(\d+)y$/.exec(k);
    return m?.[1] ? Number(m[1]) : 99;
  };
  return keys.sort((a, b) => rank(a) - rank(b));
}

export function factorRows(factors: PrismFactors | null | undefined, window: string): FactorRow[] {
  const w = factors?.windows?.[window] ?? null;
  const betas = w?.betas ?? {};
  const tStats = w?.t_stats ?? {};
  const names = Object.keys(betas ?? {});
  const ordered = [
    ...FACTOR_ORDER.filter((f) => names.includes(f)),
    ...names.filter((n) => !FACTOR_ORDER.includes(n as (typeof FACTOR_ORDER)[number])),
  ];
  return ordered.map((name) => ({
    name,
    beta: num(betas?.[name]),
    t: num(tStats?.[name]),
  }));
}

/**
 * The factor library is published on a lag: on the live NVDA packet the
 * windows end 2026-06-30 while the packet itself is as of 2026-09-01. Past
 * this many days the card stops presenting the betas as current exposure.
 */
export const FACTOR_STALE_AFTER_DAYS = 30;

export type FactorFreshness = {
  /** Last date in the factor-return file. */
  asOf: string | null;
  /** The engine's own count of the gap, in calendar days. */
  staleDays: number | null;
  stale: boolean;
  /** Latest `end` across the fitted windows — what the betas actually cover. */
  windowEnd: string | null;
};

/** What the factor card is allowed to say about how current its betas are. */
export function factorFreshness(factors: PrismFactors | null | undefined): FactorFreshness {
  const asOf = str(factors?.as_of);
  const staleDays = num(factors?.stale_days);
  let windowEnd: string | null = null;
  for (const window of Object.values(factors?.windows ?? {})) {
    const end = str(window?.end);
    // ISO dates sort lexicographically, so string comparison is the max.
    if (end !== null && (windowEnd === null || end > windowEnd)) windowEnd = end;
  }
  return {
    asOf,
    staleDays,
    stale: staleDays !== null && staleDays > FACTOR_STALE_AFTER_DAYS,
    windowEnd,
  };
}

/** The sample dates one fitted window covers, when the engine reported them. */
export function factorWindowRange(
  factors: PrismFactors | null | undefined,
  window: string,
): { start: string | null; end: string | null } {
  const w = factors?.windows?.[window] ?? null;
  return { start: str(w?.start), end: str(w?.end) };
}

// -------- spectral --------

export type CycleNode = {
  periodDays: number | null;
  /** "63d" / "1.4y" — the human name of the mode. */
  label: string;
  phaseFraction: number;
  /** Unit-circle offsets: trough at the bottom, peak at the top, rising to the right. */
  unitX: number;
  unitY: number;
  share: number;
  amplitude: number | null;
  position: string | null;
};

/**
 * Phase fraction in `[0,1)` where 0 = trough and 0.5 = peak. Falls back to
 * `phase_rad` when the engine did not precompute the fraction.
 */
export function phaseFractionOf(mode: PrismSpectralMode | null | undefined): number | null {
  const f = num(mode?.phase_fraction);
  if (f !== null) return ((f % 1) + 1) % 1;
  const rad = num(mode?.phase_rad);
  if (rad === null) return null;
  const twoPi = Math.PI * 2;
  return (((rad / twoPi) % 1) + 1) % 1;
}

/**
 * Mode periods are in *trading* days, so a year is 252 and a month 21 — a
 * 252-day mode is "1.0y", not "12mo".
 */
export function cyclePeriodLabel(periodDays: number | null): string {
  if (periodDays === null) return "—";
  if (periodDays >= 252) return `${(periodDays / 252).toFixed(1)}y`;
  if (periodDays >= 21) return `${Math.round(periodDays / 21)}mo`;
  return `${Math.round(periodDays)}d`;
}

/** Place each mode on the cycle wheel. Radius is the caller's job; share is here. */
export function cycleNodes(modes: PrismSpectralMode[] | null | undefined, limit = 6): CycleNode[] {
  const out: CycleNode[] = [];
  for (const mode of modes ?? []) {
    const f = phaseFractionOf(mode);
    if (f === null) continue;
    const angle = 2 * Math.PI * f;
    const periodDays = num(mode?.period_days);
    out.push({
      periodDays,
      label: cyclePeriodLabel(periodDays),
      phaseFraction: f,
      unitX: Math.sin(angle),
      unitY: Math.cos(angle),
      share: Math.max(0, num(mode?.power_share) ?? 0),
      amplitude: num(mode?.amplitude),
      position:
        typeof mode?.cycle_position === "string" && mode.cycle_position.trim()
          ? mode.cycle_position.trim()
          : null,
    });
  }
  return out.sort((a, b) => b.share - a.share).slice(0, Math.max(1, limit));
}

export type WavePoint = { t: number; value: number };

/**
 * Composite cycle wave around today, normalised to `[-1,1]`.
 *
 * Each mode contributes `−amplitude·cos(2π(f + t/period))`, which is exactly
 * the phase-fraction convention above: at `t = 0, f = 0` the mode sits at its
 * trough, at `f = 0.5` at its peak. `t` is in trading days, negative into the
 * past. Amplitudes fall back to power share when absent.
 */
export function reconstructWave(
  modes: PrismSpectralMode[] | null | undefined,
  opts: { past?: number; forward?: number; step?: number } = {},
): { points: WavePoint[]; nowIndex: number } {
  const past = Math.max(0, opts.past ?? 250);
  const forward = Math.max(0, opts.forward ?? 250);
  const step = Math.max(1, opts.step ?? 5);
  const usable = (modes ?? [])
    .map((m) => ({
      period: num(m?.period_days),
      f: phaseFractionOf(m),
      a: num(m?.amplitude) ?? num(m?.power_share) ?? 0,
    }))
    .filter(
      (m): m is { period: number; f: number; a: number } =>
        m.period !== null && m.f !== null && m.period > 0 && m.a > 0,
    );
  if (usable.length === 0) return { points: [], nowIndex: 0 };

  const points: WavePoint[] = [];
  let nowIndex = 0;
  let peak = 0;
  for (let t = -past; t <= forward; t += step) {
    let v = 0;
    for (const m of usable) v += -m.a * Math.cos(2 * Math.PI * (m.f + t / m.period));
    if (Math.abs(v) > peak) peak = Math.abs(v);
    if (t <= 0) nowIndex = points.length;
    points.push({ t, value: v });
  }
  if (peak > 0) for (const p of points) p.value /= peak;
  return { points, nowIndex };
}

// -------- entropy --------

/** Engine thresholds: < 0.35 structure, > 0.7 noise, otherwise mixed. */
export function classifyEntropy(h: number | null): "structure" | "mixed" | "noise" | null {
  if (h === null) return null;
  if (h < 0.35) return "structure";
  if (h > 0.7) return "noise";
  return "mixed";
}

/**
 * Where this window's H sits inside the ticker's own history of H, in `[0,1]`.
 *
 * An absolute entropy of 0.88 says little on its own; "94th percentile of its
 * own history" says the distribution is unusually spread for *this* ticker. The
 * recalibrated engine calls this `H_quantile`; earlier packets call it
 * `percentile`. Both are read, and anything outside `[0,1]` is refused rather
 * than clamped — a figure that far off is a units mismatch, not a percentile.
 */
export function entropyPercentile(window: PrismEntropyWindow | null | undefined): number | null {
  const value = num(window?.H_quantile) ?? num(window?.percentile);
  if (value === null) return null;
  return value >= 0 && value <= 1 ? value : null;
}

export function entropyTone(classification: string | null | undefined): Tone {
  if (classification === "structure") return "bull";
  if (classification === "noise") return "bear";
  return "neutral";
}

// -------- macro --------

export type CurvePoint = { tenorYears: number; label: string; value: number };

const TENORS: ReadonlyArray<{ id: string; years: number; label: string }> = [
  { id: "DGS2", years: 2, label: "2Y" },
  { id: "DGS5", years: 5, label: "5Y" },
  { id: "DGS10", years: 10, label: "10Y" },
  { id: "DGS20", years: 20, label: "20Y" },
];

/** Treasury points for the mini yield curve, in tenor order, gaps dropped. */
export function yieldCurvePoints(macro: PrismMacro | null | undefined): CurvePoint[] {
  const yields = macro?.yields ?? {};
  const out: CurvePoint[] = [];
  for (const tenor of TENORS) {
    const value = num(yields?.[tenor.id]?.current);
    if (value === null) continue;
    out.push({ tenorYears: tenor.years, label: tenor.label, value });
  }
  return out;
}

export type MacroTile = {
  key: string;
  label: string;
  series: PrismMacroSeries;
  unit: "points" | "price" | "index" | "level" | "thousands";
  /** Which direction is risk-on for this series — the tile colors its change by it. */
  bullish: "up" | "down";
};

/** The six macro tiles beside the curve: VIX, gold, dollar, WTI, HY spread, payrolls. */
export function macroTiles(macro: PrismMacro | null | undefined): MacroTile[] {
  const spec: Array<Omit<MacroTile, "series"> & { pick: PrismMacroSeries | null | undefined }> = [
    { key: "vix", label: "VIX", unit: "points", bullish: "down", pick: macro?.vix },
    { key: "gold", label: "Gold (GLD)", unit: "price", bullish: "up", pick: macro?.gold },
    { key: "dollar", label: "Dollar (DXY)", unit: "index", bullish: "down", pick: macro?.dollar },
    { key: "wti", label: "WTI crude", unit: "price", bullish: "up", pick: macro?.wti },
    {
      key: "hy_spread",
      label: "HY spread",
      unit: "points",
      bullish: "down",
      pick: macro?.hy_spread,
    },
    { key: "nfp", label: "Payrolls", unit: "thousands", bullish: "up", pick: macro?.nfp },
  ];
  const out: MacroTile[] = [];
  for (const s of spec) {
    if (!s.pick) continue;
    out.push({ key: s.key, label: s.label, unit: s.unit, bullish: s.bullish, series: s.pick });
  }
  return out;
}

// -------- volatility --------

export type SmilePoint = {
  moneyness: number;
  iv: number;
  type: string | null;
  strike: number | null;
};

/** Smile points sorted by moneyness with anything unplottable dropped. */
export function smileCurve(vol: PrismVolatility | null | undefined): SmilePoint[] {
  const out: SmilePoint[] = [];
  for (const p of vol?.implied?.smile ?? []) {
    const moneyness = num(p?.moneyness);
    const iv = num(p?.iv);
    if (moneyness === null || iv === null) continue;
    out.push({
      moneyness,
      iv,
      type: typeof p?.type === "string" ? p.type : null,
      strike: num(p?.strike),
    });
  }
  return out.sort((a, b) => a.moneyness - b.moneyness);
}

// -------- levels --------

export type LevelRow = {
  price: number;
  kind: string;
  source: string | null;
  /** Distance from the current price as a decimal fraction; null without a price. */
  distance: number | null;
};

/**
 * Auction levels plus the engine's own key levels, highest price first. The
 * auction triple is folded in explicitly so VAH/POC/VAL always appear even when
 * `key_levels` omits them.
 */
export function keyLevelRows(
  levels: PrismLevels | null | undefined,
  currentPrice: number | null,
): LevelRow[] {
  const rows: LevelRow[] = [];
  const add = (price: number | null, kind: string, source: string | null) => {
    if (price === null) return;
    if (rows.some((r) => r.kind === kind && Math.abs(r.price - price) < 1e-9)) return;
    rows.push({
      price,
      kind,
      source,
      distance: currentPrice !== null && currentPrice > 0 ? price / currentPrice - 1 : null,
    });
  };
  add(num(levels?.auction?.vah), "VAH", "auction");
  add(num(levels?.auction?.poc), "POC", "auction");
  add(num(levels?.auction?.val), "VAL", "auction");
  for (const level of levels?.key_levels ?? []) {
    add(
      num(level?.price),
      typeof level?.kind === "string" && level.kind.trim() ? level.kind.trim() : "level",
      typeof level?.source === "string" && level.source.trim() ? level.source.trim() : null,
    );
  }
  return rows.sort((a, b) => b.price - a.price);
}

// -------- fundamentals --------

export type QuarterSeries = { labels: string[]; values: number[]; latest: number | null };

/** One numeric field across the quarters, oldest → newest, gaps dropped in pairs. */
export function quarterSeries(
  quarters: PrismQuarter[] | null | undefined,
  field: keyof PrismQuarter,
): QuarterSeries {
  const labels: string[] = [];
  const values: number[] = [];
  for (const q of quarters ?? []) {
    const value = num(q?.[field]);
    if (value === null) continue;
    labels.push(
      (typeof q?.fiscal_quarter === "string" && q.fiscal_quarter) ||
        (typeof q?.period_end === "string" ? q.period_end.slice(0, 7) : "—"),
    );
    values.push(value);
  }
  return { labels, values, latest: values.length > 0 ? (values[values.length - 1] ?? null) : null };
}

/** Trailing growth of a quarter series over `lag` quarters (4 = year over year). */
export function seriesGrowth(values: number[], lag = 4): number | null {
  if (values.length <= lag) return null;
  const last = values[values.length - 1];
  const base = values[values.length - 1 - lag];
  if (last === undefined || base === undefined || !(Math.abs(base) > 0)) return null;
  return last / base - 1;
}
