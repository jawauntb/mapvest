import type {
  PrismEntryZone,
  PrismHorizonKey,
  PrismHorizonOutlook,
  PrismScenarioCase,
  PrismScenarioCaseKey,
  PrismScenarios,
} from "@/api/prism";
/**
 * Scenario math for the Prism UI — pure, dependency-free, unit tested.
 *
 * The engine hands us three *cases* (bull / neutral / bear), each with its own
 * probability and its own p10/p50/p90 per horizon. Nothing in the packet is a
 * single blended forecast, so the fan chart and the density curve have to do
 * the mixing here. Two rules keep that honest:
 *
 *   • A case only contributes the quantiles it actually has. A case with no
 *     numbers contributes nothing rather than a zero.
 *   • The mixture is a *weighted* mixture of the cases' own quantiles — we
 *     never average a bull p90 with a bear p90 as if they were one series.
 */
import { PRISM_HORIZONS, PRISM_HORIZON_MONTHS, SCENARIO_CASES } from "./constants";

export { SCENARIO_CASES } from "./constants";

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export type WeightedSample = { value: number; weight: number };

/**
 * Weighted quantile with the standard "mass midpoint" convention: a sample
 * sits at the centre of its own probability mass, and we interpolate linearly
 * between neighbours. Two equal samples at 0 and 10 therefore give a median of
 * 5 rather than an arbitrary pick of one endpoint.
 */
export function weightedQuantile(samples: WeightedSample[], q: number): number | null {
  const usable = samples
    .filter((s) => Number.isFinite(s.value) && Number.isFinite(s.weight) && s.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (usable.length === 0) return null;
  const first = usable[0];
  const last = usable[usable.length - 1];
  if (!first || !last) return null;
  if (usable.length === 1) return first.value;
  const total = usable.reduce((acc, s) => acc + s.weight, 0);
  if (!(total > 0)) return null;
  const target = Math.min(1, Math.max(0, q));

  // Midpoint position of each sample's mass in [0,1].
  const positions: number[] = [];
  let cum = 0;
  for (const s of usable) {
    positions.push((cum + s.weight / 2) / total);
    cum += s.weight;
  }
  const firstPos = positions[0] ?? 0;
  const lastPos = positions[positions.length - 1] ?? 1;
  if (target <= firstPos) return first.value;
  if (target >= lastPos) return last.value;
  for (let i = 1; i < usable.length; i++) {
    const p0 = positions[i - 1];
    const p1 = positions[i];
    const a = usable[i - 1];
    const b = usable[i];
    if (p0 === undefined || p1 === undefined || !a || !b) continue;
    if (target <= p1) {
      const span = p1 - p0;
      const f = span > 0 ? (target - p0) / span : 0;
      return a.value + (b.value - a.value) * f;
    }
  }
  return last.value;
}

/** Probabilities as the engine gave them, renormalised when they do not sum to 1. */
export function caseProbabilities(
  scenarios: PrismScenarios | null | undefined,
): Array<{ key: PrismScenarioCaseKey; probability: number; narrative: string | null }> {
  const cases = scenarios?.cases ?? null;
  const raw = SCENARIO_CASES.map((key) => {
    const c: PrismScenarioCase | null | undefined = cases?.[key];
    return {
      key,
      probability: num(c?.probability) ?? 0,
      narrative: typeof c?.narrative === "string" && c.narrative.trim() ? c.narrative.trim() : null,
    };
  });
  const total = raw.reduce((acc, r) => acc + Math.max(0, r.probability), 0);
  if (!(total > 0)) return raw.map((r) => ({ ...r, probability: 0 }));
  return raw.map((r) => ({ ...r, probability: Math.max(0, r.probability) / total }));
}

function outlookOf(
  scenarios: PrismScenarios | null | undefined,
  key: PrismScenarioCaseKey,
  horizon: PrismHorizonKey,
): PrismHorizonOutlook | null {
  return scenarios?.cases?.[key]?.horizons?.[horizon] ?? null;
}

export type FanPoint = {
  horizon: PrismHorizonKey;
  months: number;
  /** Probability-weighted mean expected return across the cases. */
  expected: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  /** Same mixture applied to the price fan, when the engine priced it. */
  pricep10: number | null;
  pricep50: number | null;
  pricep90: number | null;
  /** How many cases actually contributed numbers at this horizon. */
  contributors: number;
};

/**
 * Interior weights of a case's own three-point quantile summary. A p10 and a
 * p90 each stand for a tail decile; the median carries the rest.
 */
const TAIL_MASS = 0.2;
const BODY_MASS = 0.6;

function mixField(
  scenarios: PrismScenarios | null | undefined,
  horizon: PrismHorizonKey,
  probs: ReturnType<typeof caseProbabilities>,
  fields: {
    lo: keyof PrismHorizonOutlook;
    mid: keyof PrismHorizonOutlook;
    hi: keyof PrismHorizonOutlook;
    point?: keyof PrismHorizonOutlook;
  },
): { p10: number | null; p50: number | null; p90: number | null; contributors: number } {
  const samples: WeightedSample[] = [];
  let contributors = 0;
  for (const { key, probability } of probs) {
    if (!(probability > 0)) continue;
    const o = outlookOf(scenarios, key, horizon);
    if (!o) continue;
    const lo = num(o[fields.lo]);
    const mid = num(o[fields.mid]) ?? (fields.point ? num(o[fields.point]) : null);
    const hi = num(o[fields.hi]);
    if (lo === null && mid === null && hi === null) continue;
    contributors += 1;
    if (lo !== null) samples.push({ value: lo, weight: probability * TAIL_MASS });
    if (mid !== null) {
      const mass = lo === null && hi === null ? 1 : BODY_MASS;
      samples.push({ value: mid, weight: probability * mass });
    }
    if (hi !== null) samples.push({ value: hi, weight: probability * TAIL_MASS });
  }
  return {
    p10: weightedQuantile(samples, 0.1),
    p50: weightedQuantile(samples, 0.5),
    p90: weightedQuantile(samples, 0.9),
    contributors,
  };
}

/** One fan point per horizon, always all six, `null` where nothing was projected. */
export function horizonFan(scenarios: PrismScenarios | null | undefined): FanPoint[] {
  const probs = caseProbabilities(scenarios);
  return PRISM_HORIZONS.map((horizon) => {
    const ret = mixField(scenarios, horizon, probs, {
      lo: "p10",
      mid: "p50",
      hi: "p90",
      point: "expected_return",
    });
    const price = mixField(scenarios, horizon, probs, {
      lo: "price_p10",
      mid: "price_p50",
      hi: "price_p90",
    });

    let expectedNum = 0;
    let expectedDen = 0;
    for (const { key, probability } of probs) {
      const o = outlookOf(scenarios, key, horizon);
      const e = num(o?.expected_return) ?? num(o?.p50);
      if (e === null || !(probability > 0)) continue;
      expectedNum += e * probability;
      expectedDen += probability;
    }

    return {
      horizon,
      months: PRISM_HORIZON_MONTHS[horizon],
      expected: expectedDen > 0 ? expectedNum / expectedDen : ret.p50,
      p10: ret.p10,
      p50: ret.p50,
      p90: ret.p90,
      pricep10: price.p10,
      pricep50: price.p50,
      pricep90: price.p90,
      contributors: ret.contributors,
    };
  });
}

/** The 10th/90th-percentile z-score — how a p10..p90 spread maps onto a sigma. */
const Z90 = 1.2815515655446004;

export type DensityPoint = { x: number; y: number };

export type ScenarioDensity = {
  points: DensityPoint[];
  /** Per-case peak, so the chart can label where each narrative sits. */
  marks: Array<{ key: PrismScenarioCaseKey; x: number; probability: number }>;
  min: number;
  max: number;
};

/**
 * Mixture density over the return axis for one horizon: each case becomes a
 * Gaussian whose centre is its median and whose sigma comes from its own
 * p10..p90 spread, weighted by the case probability. Densities are normalised
 * to a peak of 1 because the chart is a shape, not a pdf with units.
 */
export function densityCurve(
  scenarios: PrismScenarios | null | undefined,
  horizon: PrismHorizonKey,
  steps = 72,
): ScenarioDensity | null {
  const probs = caseProbabilities(scenarios);
  const comps: Array<{ key: PrismScenarioCaseKey; mu: number; sigma: number; w: number }> = [];
  for (const { key, probability } of probs) {
    if (!(probability > 0)) continue;
    const o = outlookOf(scenarios, key, horizon);
    if (!o) continue;
    const mu = num(o.p50) ?? num(o.expected_return);
    if (mu === null) continue;
    const lo = num(o.p10);
    const hi = num(o.p90);
    let sigma = lo !== null && hi !== null && hi > lo ? (hi - lo) / (2 * Z90) : null;
    if (sigma === null || !(sigma > 0)) sigma = Math.max(Math.abs(mu) * 0.4, 0.01);
    comps.push({ key, mu, sigma, w: probability });
  }
  if (comps.length === 0) return null;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const c of comps) {
    min = Math.min(min, c.mu - 3 * c.sigma);
    max = Math.max(max, c.mu + 3 * c.sigma);
  }
  if (!(max > min)) {
    min -= 0.01;
    max += 0.01;
  }

  const n = Math.max(8, Math.round(steps));
  const points: DensityPoint[] = [];
  let peak = 0;
  for (let i = 0; i <= n; i++) {
    const x = min + ((max - min) * i) / n;
    let y = 0;
    for (const c of comps) {
      const z = (x - c.mu) / c.sigma;
      y += (c.w / c.sigma) * Math.exp(-0.5 * z * z);
    }
    if (y > peak) peak = y;
    points.push({ x, y });
  }
  const scaled = peak > 0 ? points.map((p) => ({ x: p.x, y: p.y / peak })) : points;
  return {
    points: scaled,
    marks: comps.map((c) => ({ key: c.key, x: c.mu, probability: c.w })),
    min,
    max,
  };
}

export type EntryBand = {
  bargain: number | null;
  fair: number | null;
  expensive: number | null;
  current: number | null;
  /** Current price's position on the drawn axis, `[0,1]`; null when unplottable. */
  t: number | null;
  /** Axis endpoints actually drawn (band padded so the marker never sits on the edge). */
  axisMin: number | null;
  axisMax: number | null;
  zone: "bargain" | "fair" | "expensive" | null;
  /** Current vs fair as a decimal fraction, from the packet or derived. */
  vsFair: number | null;
};

/** Lay the entry zone onto a 0..1 axis and say which band the price is in. */
export function entryBand(entry: PrismEntryZone | null | undefined): EntryBand {
  const bargain = num(entry?.bargain_below);
  const fair = num(entry?.fair_value);
  const expensive = num(entry?.expensive_above);
  const current = num(entry?.current_price);
  const vsFairRaw = num(entry?.current_vs_fair);
  const vsFair =
    vsFairRaw ?? (current !== null && fair !== null && fair !== 0 ? current / fair - 1 : null);

  const anchors = [bargain, fair, expensive, current].filter((v): v is number => v !== null);
  if (anchors.length < 2) {
    return {
      bargain,
      fair,
      expensive,
      current,
      t: null,
      axisMin: null,
      axisMax: null,
      zone: zoneOf(current, bargain, expensive),
      vsFair,
    };
  }
  const lo = Math.min(...anchors);
  const hi = Math.max(...anchors);
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.02 || 1;
  const axisMin = lo - pad;
  const axisMax = hi + pad;
  const span = axisMax - axisMin;
  const t = current !== null && span > 0 ? (current - axisMin) / span : null;
  return {
    bargain,
    fair,
    expensive,
    current,
    t: t === null ? null : Math.min(1, Math.max(0, t)),
    axisMin,
    axisMax,
    zone: zoneOf(current, bargain, expensive),
    vsFair,
  };
}

function zoneOf(
  current: number | null,
  bargain: number | null,
  expensive: number | null,
): "bargain" | "fair" | "expensive" | null {
  if (current === null) return null;
  if (bargain !== null && current <= bargain) return "bargain";
  if (expensive !== null && current >= expensive) return "expensive";
  if (bargain === null && expensive === null) return null;
  return "fair";
}

export type WeightRow = { key: string; weight: number; share: number };

/**
 * Mixture weights as a sorted, normalised list. Negative or non-finite weights
 * are dropped rather than folded in — the bar chart shows contribution share.
 */
export function normalizeWeights(weights: Record<string, unknown> | null | undefined): WeightRow[] {
  const rows: Array<{ key: string; weight: number }> = [];
  for (const [key, raw] of Object.entries(weights ?? {})) {
    const w = num(raw);
    if (w === null || w <= 0) continue;
    rows.push({ key, weight: w });
  }
  const total = rows.reduce((acc, r) => acc + r.weight, 0);
  return rows
    .map((r) => ({ ...r, share: total > 0 ? r.weight / total : 0 }))
    .sort((a, b) => b.share - a.share);
}

/**
 * The exit ladder as the hero renders it: horizon, price, probability, and the
 * implied return against the current price when both are known.
 */
export function exitLadder(
  targets:
    | Array<{
        horizon?: string | null;
        price?: unknown;
        probability?: unknown;
        basis?: unknown;
      }>
    | null
    | undefined,
  currentPrice: number | null,
): Array<{
  horizon: string;
  price: number | null;
  /**
   * The bull case's probability at this horizon. NOT the probability of
   * reaching `price` — see `PrismExitTarget.probability` and `basis`.
   */
  probability: number | null;
  /** The engine's description of what `price` is; `null` when it did not say. */
  basis: string | null;
  ret: number | null;
}> {
  return (targets ?? []).map((t) => {
    const price = num(t.price);
    return {
      horizon: typeof t.horizon === "string" && t.horizon.trim() ? t.horizon.trim() : "—",
      price,
      probability: num(t.probability),
      basis: typeof t.basis === "string" && t.basis.trim() ? t.basis.trim() : null,
      ret:
        price !== null && currentPrice !== null && currentPrice > 0
          ? price / currentPrice - 1
          : null,
    };
  });
}

/** The single basis line an exit ladder should print, when the rungs agree on one. */
export function ladderBasis(rows: ReadonlyArray<{ basis: string | null }>): string | null {
  const first = rows.find((r) => r.basis !== null)?.basis ?? null;
  if (first === null) return null;
  return rows.every((r) => r.basis === null || r.basis === first) ? first : null;
}

export type WeightEvidenceRead = {
  /** Non-null when the engine fell back to a prior instead of measured skill. */
  fallback: string | null;
  /** The engine's own explanation of why. */
  reason: string | null;
  /** Components that were never scored — their weight is assumed, not earned. */
  priorOnly: string[];
  /** Share of the total weight that was never measured, in [0,1]. */
  unscoredPriorMass: number | null;
};

/**
 * What the engine actually says about its own weights.
 *
 * The scenario card used to assert unconditionally that the weights *are*
 * out-of-sample explanatory power. On real packets that is often false: the
 * engine reports `fallback: "relative_skill_ranking"` with
 * `reason: "no component beat the naive constant forecast out of sample"` and
 * lists the components it never scored at all. Reading this is the difference
 * between the UI matching the engine and the UI overclaiming for it.
 */
export function weightEvidence(
  scenarios: PrismScenarios | null | undefined,
): WeightEvidenceRead | null {
  const raw = scenarios?.weight_evidence;
  if (!raw || typeof raw !== "object") return null;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    fallback: str(raw.fallback),
    reason: str(raw.reason) ?? str(raw.fallback_note),
    priorOnly: Array.isArray(raw.prior_only_components)
      ? raw.prior_only_components.filter((v): v is string => typeof v === "string" && !!v.trim())
      : [],
    unscoredPriorMass: num(raw.unscored_prior_mass),
  };
}

// -------- component shrinkage --------

/**
 * A number that may be reported flat or per horizon.
 *
 * The engine's component blocks key `expected_return` and `sigma` by horizon
 * (`{ "1m": 0.01, "3m": 0.03 }`), and the recalibration's `shrinkage` block may
 * follow either convention. Reading both means the card works on whichever
 * shape ships, and returns `null` rather than a guess on anything else.
 */
export function numberAtHorizon(value: unknown, horizon: PrismHorizonKey): number | null {
  const flat = num(value);
  if (flat !== null) return flat;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return num((value as Record<string, unknown>)[horizon]);
  }
  return null;
}

/** `[lo, hi]` from `[lo, hi]`, `{low, high}`, `{min, max}`, flat or per horizon. */
export function clampBoundsAtHorizon(
  value: unknown,
  horizon: PrismHorizonKey,
): { lo: number | null; hi: number | null } {
  const none = { lo: null, hi: null };
  if (!value || typeof value !== "object") return none;
  if (Array.isArray(value)) {
    return { lo: num(value[0]), hi: num(value[1]) };
  }
  const obj = value as Record<string, unknown>;
  const lo = num(obj.low ?? obj.lo ?? obj.min);
  const hi = num(obj.high ?? obj.hi ?? obj.max);
  if (lo !== null || hi !== null) return { lo, hi };
  // Not a bounds object itself — try the per-horizon entry.
  const nested = obj[horizon];
  if (nested && typeof nested === "object") return clampBoundsAtHorizon(nested, horizon);
  return none;
}

export type ShrinkageRow = {
  key: string;
  /** The component's own forecast at this horizon, before shrinkage. */
  raw: number | null;
  /** The prior it was pulled toward. */
  prior: number | null;
  /** What the mixture used. */
  shrunk: number | null;
  /** Share of the prior mixed in, `[0,1]`. */
  weight: number | null;
  lo: number | null;
  hi: number | null;
  /** The shrunk value sits on one of its own bounds — it was cut, not chosen. */
  clamped: boolean;
};

/**
 * Per-component shrinkage at one horizon, in the engine's own key order.
 *
 * Only components that actually reported a `shrinkage` block appear, and a row
 * survives only if it carries at least a raw or a shrunk number — an empty
 * block is not evidence of anything and must not render as a pair of dashes.
 * A packet built before the recalibration yields `[]`, which is how the card
 * knows to say nothing at all.
 */
export function shrinkageRows(
  scenarios: PrismScenarios | null | undefined,
  horizon: PrismHorizonKey,
): ShrinkageRow[] {
  const rows: ShrinkageRow[] = [];
  for (const [key, component] of Object.entries(scenarios?.components ?? {})) {
    const block = component?.shrinkage;
    if (!block || typeof block !== "object") continue;
    const raw = numberAtHorizon(block.raw_expected_return, horizon);
    const shrunk = numberAtHorizon(block.expected_return, horizon);
    if (raw === null && shrunk === null) continue;
    const { lo, hi } = clampBoundsAtHorizon(component?.clamp_bounds, horizon);
    const onBound =
      shrunk !== null &&
      ((lo !== null && Math.abs(shrunk - lo) < 1e-9) ||
        (hi !== null && Math.abs(shrunk - hi) < 1e-9));
    rows.push({
      key,
      raw,
      prior: numberAtHorizon(block.prior, horizon),
      shrunk,
      weight: numberAtHorizon(block.shrink_weight, horizon),
      lo,
      hi,
      clamped: onBound,
    });
  }
  return rows;
}
