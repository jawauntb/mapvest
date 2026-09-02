import { describe, expect, test } from "bun:test";
import type { PrismRegimes, PrismRelational, PrismSpectralMode } from "@/api/prism";
import {
  classifyEntropy,
  cycleNodes,
  cyclePeriodLabel,
  entropyPercentile,
  entropyTone,
  factorFreshness,
  factorRows,
  factorWindowRange,
  factorWindows,
  keyLevelRows,
  macroTiles,
  phaseFractionOf,
  quarterSeries,
  reconstructWave,
  regimeLabelById,
  regimePosterior,
  regimeRuns,
  regimeStateVol,
  relationalRows,
  seasonalityRows,
  seriesGrowth,
  smileCurve,
  yieldCurvePoints,
} from "./signals";

const regimes: PrismRegimes = {
  trained_on: "SPY",
  n_states: 3,
  states: [
    { id: 0, label: "bear", mean_daily_return: -0.0012, volatility: 0.021 },
    { id: 1, label: "neutral", mean_daily_return: 0.0002, volatility: 0.009 },
    { id: 2, label: "bull", mean_daily_return: 0.0009, volatility: 0.006 },
  ],
  current: { state: 2, label: "bull", posterior: [0.05, 0.15, 0.8], days_in_regime: 34 },
  history: [
    { date: "2026-01-31", state: 2 },
    { date: "2026-02-28", state: 2 },
    { date: "2026-03-31", state: 0 },
    { date: "2026-04-30", state: 1 },
    { date: "2026-05-31", state: 1 },
  ],
};

describe("regimes", () => {
  test("state ids resolve through the packet's own states table", () => {
    expect(regimeLabelById(regimes, 0)).toBe("bear");
    expect(regimeLabelById(regimes, 7)).toBeNull();
    expect(regimeLabelById(regimes, null)).toBeNull();
  });

  test("history run-length encodes into ribbon segments", () => {
    const runs = regimeRuns(regimes);
    expect(runs.map((r) => r.label)).toEqual(["bull", "bear", "neutral"]);
    expect(runs[0]?.points).toBe(2);
    expect(runs[0]?.startDate).toBe("2026-01-31");
    expect(runs[0]?.endDate).toBe("2026-02-28");
    expect(runs[0]?.tone).toBe("bull");
    expect(runs[1]?.tone).toBe("bear");
    expect(runs[2]?.tone).toBe("neutral");
  });

  test("no history is an empty ribbon, not a fabricated one", () => {
    expect(regimeRuns(null)).toEqual([]);
    expect(regimeRuns({ history: [] })).toEqual([]);
  });

  test("a state's volatility is the annualized figure, never the raw feature", () => {
    // The engine ships both: `volatility` is the 10-day MSE feature (~1e-5),
    // which would render as "0.0%" under a percent formatter.
    expect(
      regimeStateVol({
        volatility: 7.49e-5,
        vol_feature_mean: 7.49e-5,
        volatility_annualized: 0.0973,
      }),
    ).toBeCloseTo(0.0973, 10);
    // No annualized figure means "n/a" on screen, not the feature dressed up.
    expect(regimeStateVol({ volatility: 7.49e-5, vol_feature_mean: 7.49e-5 })).toBeNull();
    expect(regimeStateVol(null)).toBeNull();
  });

  test("posterior aligns to the states table and renormalises", () => {
    const slices = regimePosterior(regimes);
    expect(slices.map((s) => s.label)).toEqual(["bear", "neutral", "bull"]);
    expect(slices[2]?.p).toBeCloseTo(0.8, 10);
    const skewed = regimePosterior({ ...regimes, current: { posterior: [1, 1, 2] } });
    expect(skewed[2]?.p).toBeCloseTo(0.5, 10);
    expect(regimePosterior(null)).toEqual([]);
  });
});

describe("seasonality", () => {
  const rows = seasonalityRows(
    {
      month: 9,
      month_label: "September",
      ticker: {
        this_month: {
          "1y": { mean: 0.04, hit_rate: 1, n: 1 },
          "5y": { mean: 0.021, hit_rate: 0.6, n: 5 },
        },
        trend: { direction: "accelerating" },
      },
      benchmarks: { SPY: { this_month: { "10y": { mean: -0.005, hit_rate: 0.4, n: 10 } } } },
    },
    "NVDA",
  );

  test("the ticker leads and every row keeps all four windows", () => {
    expect(rows.map((r) => r.symbol)).toEqual(["NVDA", "SPY"]);
    expect(rows[0]?.isTicker).toBe(true);
    expect(rows[0]?.cells.map((c) => c.window)).toEqual(["1y", "2y", "5y", "10y"]);
  });

  test("missing windows are null cells, never zeros", () => {
    const missing = rows[0]?.cells.find((c) => c.window === "2y");
    expect(missing?.mean).toBeNull();
    expect(missing?.n).toBeNull();
    expect(rows[0]?.trend).toBe("accelerating");
    expect(rows[1]?.trend).toBeNull();
  });
});

describe("relational", () => {
  const relational: PrismRelational = {
    correlation: {
      SPY: { "3m": 0.4, "1y": 0.62 },
      SOXX: { "1y": 0.91 },
      GLD: { "1y": -0.12 },
    },
    beta: { SPY: { "1y": 1.4, rolling_trend: "rising" }, SOXX: { "1y": 1.1 } },
    kinematics: { SOXX: { velocity: 0.002, acceleration: -0.0004 } },
    impact_weights: { SOXX: { weight: 0.44 } },
  };

  test("rows sort by the strength of the 1-year correlation", () => {
    const rows = relationalRows(relational);
    expect(rows.map((r) => r.symbol)).toEqual(["SOXX", "SPY", "GLD"]);
    expect(rows[0]?.impactWeight).toBeCloseTo(0.44, 10);
    expect(rows[0]?.velocity).toBeCloseTo(0.002, 10);
    expect(rows[1]?.beta1y).toBeCloseTo(1.4, 10);
    expect(rows[1]?.betaTrend).toBe("rising");
  });

  test("every window slot exists even when the engine had none", () => {
    const rows = relationalRows(relational);
    expect(rows[0]?.correlation.map((c) => c.window)).toEqual([
      "3m",
      "6m",
      "1y",
      "2y",
      "5y",
      "10y",
    ]);
    expect(rows[0]?.correlation.find((c) => c.window === "5y")?.value).toBeNull();
    expect(relationalRows(null)).toEqual([]);
  });
});

describe("factors", () => {
  const factors = {
    windows: {
      "10y": { betas: { MKT: 1.2 } },
      "1y": {
        alpha_annual: 0.12,
        betas: { MOM: 0.3, MKT: 1.5, SMB: -0.2, QUALITY: 0.1 },
        t_stats: { MKT: 8.1, MOM: 1.2 },
      },
      "3y": { betas: { MKT: 1.3 } },
    },
  };

  test("windows come back shortest first", () => {
    expect(factorWindows(factors)).toEqual(["1y", "3y", "10y"]);
    expect(factorWindows(null)).toEqual([]);
  });

  test("freshness reads the engine's own lag, and 30 days is the line", () => {
    const live = factorFreshness({
      as_of: "2026-06-30",
      stale_days: 63,
      windows: {
        "1y": { start: "2025-06-30", end: "2026-06-30" },
        "10y": { start: "2016-08-29", end: "2026-06-30" },
      },
    });
    expect(live.asOf).toBe("2026-06-30");
    expect(live.staleDays).toBe(63);
    expect(live.stale).toBe(true);
    expect(live.windowEnd).toBe("2026-06-30");

    expect(factorFreshness({ as_of: "2026-08-31", stale_days: 2 }).stale).toBe(false);
    expect(factorFreshness({ stale_days: 30 }).stale).toBe(false);
    expect(factorFreshness({ stale_days: 31 }).stale).toBe(true);

    const none = factorFreshness(null);
    expect(none.asOf).toBeNull();
    expect(none.staleDays).toBeNull();
    expect(none.stale).toBe(false);
    expect(none.windowEnd).toBeNull();
  });

  test("a window reports the sample it was fitted on when the engine said so", () => {
    const withRange = { windows: { "1y": { start: "2025-06-30", end: "2026-06-30" } } };
    expect(factorWindowRange(withRange, "1y")).toEqual({
      start: "2025-06-30",
      end: "2026-06-30",
    });
    expect(factorWindowRange(withRange, "5y")).toEqual({ start: null, end: null });
    expect(factorWindowRange(factors, "1y")).toEqual({ start: null, end: null });
  });

  test("rows follow the canonical factor order and trail extras", () => {
    const rows = factorRows(factors, "1y");
    expect(rows.map((r) => r.name)).toEqual(["MKT", "SMB", "MOM", "QUALITY"]);
    expect(rows[0]?.t).toBeCloseTo(8.1, 10);
    expect(rows[1]?.t).toBeNull();
    expect(factorRows(factors, "20y")).toEqual([]);
  });
});

describe("spectral", () => {
  const modes: PrismSpectralMode[] = [
    {
      period_days: 252,
      amplitude: 0.1,
      phase_fraction: 0,
      power_share: 0.5,
      cycle_position: "trough",
    },
    {
      period_days: 63,
      amplitude: 0.04,
      phase_fraction: 0.5,
      power_share: 0.3,
      cycle_position: "peak",
    },
    { period_days: 21, amplitude: 0.01, phase_fraction: 0.25, power_share: 0.1 },
  ];

  test("phase fraction falls back to radians and wraps into [0,1)", () => {
    expect(phaseFractionOf({ phase_fraction: 1.25 })).toBeCloseTo(0.25, 10);
    expect(phaseFractionOf({ phase_rad: Math.PI })).toBeCloseTo(0.5, 10);
    expect(phaseFractionOf({ phase_rad: -Math.PI / 2 })).toBeCloseTo(0.75, 10);
    expect(phaseFractionOf({})).toBeNull();
  });

  test("wheel places a trough at the bottom and a peak at the top", () => {
    const nodes = cycleNodes(modes);
    expect(nodes[0]?.unitX).toBeCloseTo(0, 10);
    expect(nodes[0]?.unitY).toBeCloseTo(1, 10); // trough: bottom
    expect(nodes[1]?.unitY).toBeCloseTo(-1, 10); // peak: top
    expect(nodes[2]?.unitX).toBeCloseTo(1, 10); // rising: right
  });

  test("wheel sorts by power share and honours the limit", () => {
    const nodes = cycleNodes(modes, 2);
    expect(nodes).toHaveLength(2);
    expect(nodes.map((n) => n.label)).toEqual(["1.0y", "3mo"]);
    expect(cycleNodes(null)).toEqual([]);
  });

  test("period labels switch units", () => {
    expect(cyclePeriodLabel(504)).toBe("2.0y");
    expect(cyclePeriodLabel(63)).toBe("3mo");
    expect(cyclePeriodLabel(8)).toBe("8d");
    expect(cyclePeriodLabel(null)).toBe("—");
  });

  test("the wave reconstructs each mode's own phase convention", () => {
    const single: PrismSpectralMode[] = [
      { period_days: 20, amplitude: 1, phase_fraction: 0, power_share: 1 },
    ];
    const { points, nowIndex } = reconstructWave(single, { past: 20, forward: 20, step: 5 });
    expect(points).toHaveLength(9);
    const now = points[nowIndex];
    expect(now?.t).toBe(0);
    expect(now?.value).toBeCloseTo(-1, 6); // phase 0 = trough
    const halfPeriod = points.find((p) => p.t === 10);
    expect(halfPeriod?.value).toBeCloseTo(1, 6); // half a cycle later = peak
  });

  test("no usable modes means no wave", () => {
    expect(reconstructWave([{ amplitude: 1 }]).points).toEqual([]);
    expect(reconstructWave(null).points).toEqual([]);
  });
});

describe("entropy", () => {
  test("classification follows the engine thresholds", () => {
    expect(classifyEntropy(0.2)).toBe("structure");
    expect(classifyEntropy(0.5)).toBe("mixed");
    expect(classifyEntropy(0.85)).toBe("noise");
    expect(classifyEntropy(null)).toBeNull();
    expect(entropyTone("structure")).toBe("bull");
    expect(entropyTone("noise")).toBe("bear");
    expect(entropyTone(null)).toBe("neutral");
  });

  test("the history percentile reads either engine's name for it", () => {
    expect(entropyPercentile({ H: 0.88, H_quantile: 0.94 })).toBeCloseTo(0.94, 10);
    expect(entropyPercentile({ H: 0.88, percentile: 0.61 })).toBeCloseTo(0.61, 10);
    // The recalibrated name wins when a packet carries both.
    expect(entropyPercentile({ H_quantile: 0.94, percentile: 0.61 })).toBeCloseTo(0.94, 10);
    // Out of range is a units mismatch, not a percentile — refuse it.
    expect(entropyPercentile({ percentile: 94 })).toBeNull();
    expect(entropyPercentile({ H: 0.5 })).toBeNull();
    expect(entropyPercentile(null)).toBeNull();
  });
});

describe("macro", () => {
  const macro = {
    yields: {
      DGS2: { current: 3.9 },
      DGS10: { current: 4.3 },
      DGS20: { current: null },
    },
    vix: { series_id: "VIXCLS", current: 17.2, change_1m: -1.1 },
    gold: { current: 240 },
    nfp: { current: 158_000 },
  };

  test("curve points keep tenor order and drop gaps", () => {
    const points = yieldCurvePoints(macro);
    expect(points.map((p) => p.label)).toEqual(["2Y", "10Y"]);
    expect(points[0]?.tenorYears).toBe(2);
    expect(yieldCurvePoints(null)).toEqual([]);
  });

  test("tiles only cover the series the packet actually has", () => {
    const tiles = macroTiles(macro);
    expect(tiles.map((t) => t.key)).toEqual(["vix", "gold", "nfp"]);
    expect(tiles[0]?.bullish).toBe("down");
    expect(tiles[1]?.unit).toBe("price");
    expect(macroTiles(null)).toEqual([]);
  });
});

describe("volatility and levels", () => {
  test("smile points sort by moneyness and drop unplottable rows", () => {
    const points = smileCurve({
      implied: {
        smile: [
          { moneyness: 1.1, iv: 0.42, type: "call" },
          { moneyness: 0.9, iv: 0.55, type: "put" },
          { moneyness: null, iv: 0.5 },
          { moneyness: 1, iv: null },
        ],
      },
    });
    expect(points.map((p) => p.moneyness)).toEqual([0.9, 1.1]);
    expect(smileCurve(null)).toEqual([]);
  });

  test("levels merge the auction triple with key levels, highest first", () => {
    const rows = keyLevelRows(
      {
        auction: { vah: 210, val: 180, poc: 195 },
        key_levels: [
          { price: 240, kind: "ridge", source: "ridge-growth" },
          { price: null, kind: "broken" },
        ],
      },
      200,
    );
    expect(rows.map((r) => r.kind)).toEqual(["ridge", "VAH", "POC", "VAL"]);
    expect(rows[1]?.distance).toBeCloseTo(0.05, 10);
    expect(keyLevelRows(null, null)).toEqual([]);
  });

  test("no current price means no distances", () => {
    const rows = keyLevelRows({ auction: { poc: 195 } }, null);
    expect(rows[0]?.distance).toBeNull();
  });
});

describe("fundamentals", () => {
  const quarters = [
    { period_end: "2024-10-31", fiscal_quarter: "Q3 FY25", revenue: 100 },
    { period_end: "2025-01-31", fiscal_quarter: "Q4 FY25", revenue: 110 },
    { period_end: "2025-04-30", fiscal_quarter: "Q1 FY26", revenue: null },
    { period_end: "2025-07-31", fiscal_quarter: "Q2 FY26", revenue: 130 },
    { period_end: "2025-10-31", fiscal_quarter: "Q3 FY26", revenue: 150 },
  ];

  test("series keep order, drop gaps, and expose the latest value", () => {
    const series = quarterSeries(quarters, "revenue");
    expect(series.values).toEqual([100, 110, 130, 150]);
    expect(series.labels[0]).toBe("Q3 FY25");
    expect(series.latest).toBe(150);
    expect(quarterSeries(null, "revenue").values).toEqual([]);
  });

  test("growth needs enough history or returns null", () => {
    expect(seriesGrowth([100, 110, 130, 150, 200], 4)).toBeCloseTo(1, 10);
    expect(seriesGrowth([100, 110], 4)).toBeNull();
    expect(seriesGrowth([0, 1, 2, 3, 4], 4)).toBeNull();
  });
});
