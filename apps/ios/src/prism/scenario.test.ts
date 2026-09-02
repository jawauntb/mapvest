import { describe, expect, test } from "bun:test";
import type { PrismScenarios } from "@/api/prism";
import {
  caseProbabilities,
  densityCurve,
  entryBand,
  exitLadder,
  horizonFan,
  ladderBasis,
  normalizeWeights,
  numberAtHorizon,
  shrinkageRows,
  weightEvidence,
  weightedQuantile,
} from "./scenario";

const scenarios: PrismScenarios = {
  method: "weighted_mixture",
  weights: {
    seasonality: 0.1,
    regime: 0.3,
    factors: 0.2,
    spectral: 0.05,
    fundamentals: 0.25,
    macro: 0.1,
  },
  cases: {
    bull: {
      probability: 0.3,
      narrative: "AI capex holds and gross margin stays above 70%.",
      horizons: {
        "1m": { expected_return: 0.08, p10: 0.02, p50: 0.08, p90: 0.15, price_p50: 200 },
        "12m": { expected_return: 0.4, p10: 0.15, p50: 0.4, p90: 0.7 },
      },
    },
    neutral: {
      probability: 0.5,
      narrative: "Range-bound into the next print.",
      horizons: {
        "1m": { expected_return: 0.01, p10: -0.05, p50: 0.01, p90: 0.07, price_p50: 185 },
        "12m": { expected_return: 0.09, p10: -0.1, p50: 0.09, p90: 0.28 },
      },
    },
    bear: {
      probability: 0.2,
      narrative: "Order cuts and a multiple reset.",
      horizons: {
        "1m": { expected_return: -0.09, p10: -0.2, p50: -0.09, p90: -0.01, price_p50: 168 },
        "12m": { expected_return: -0.25, p10: -0.45, p50: -0.25, p90: -0.05 },
      },
    },
  },
};

describe("weightedQuantile", () => {
  test("two equal samples put the median between them", () => {
    expect(
      weightedQuantile(
        [
          { value: 0, weight: 1 },
          { value: 10, weight: 1 },
        ],
        0.5,
      ),
    ).toBeCloseTo(5, 10);
  });

  test("weights move the median toward the heavy sample", () => {
    const q = weightedQuantile(
      [
        { value: 0, weight: 9 },
        { value: 10, weight: 1 },
      ],
      0.5,
    );
    expect(q).not.toBeNull();
    expect(q as number).toBeLessThan(5);
    expect(q as number).toBeGreaterThanOrEqual(0);
  });

  test("clamps outside the sample range and drops junk", () => {
    const samples = [
      { value: 1, weight: 1 },
      { value: 3, weight: 1 },
      { value: Number.NaN, weight: 1 },
      { value: 5, weight: 0 },
    ];
    expect(weightedQuantile(samples, 0)).toBe(1);
    expect(weightedQuantile(samples, 1)).toBe(3);
    expect(weightedQuantile([], 0.5)).toBeNull();
  });

  test("a single sample is its own every quantile", () => {
    expect(weightedQuantile([{ value: 7, weight: 3 }], 0.9)).toBe(7);
  });
});

describe("caseProbabilities", () => {
  test("keeps the engine's split when it already sums to one", () => {
    const probs = caseProbabilities(scenarios);
    expect(probs.map((p) => p.key)).toEqual(["bull", "neutral", "bear"]);
    expect(probs[0]?.probability).toBeCloseTo(0.3, 10);
  });

  test("renormalises a split that does not sum to one", () => {
    const probs = caseProbabilities({
      cases: {
        bull: { probability: 2, narrative: "", horizons: {} },
        neutral: { probability: 2, narrative: "", horizons: {} },
        bear: { probability: 0, narrative: "", horizons: {} },
      },
    });
    expect(probs[0]?.probability).toBeCloseTo(0.5, 10);
    expect(probs[2]?.probability).toBe(0);
  });

  test("an empty scenarios object yields zero probabilities, not NaN", () => {
    const probs = caseProbabilities(null);
    expect(probs).toHaveLength(3);
    expect(probs.every((p) => p.probability === 0)).toBe(true);
  });
});

describe("horizonFan", () => {
  const fan = horizonFan(scenarios);

  test("always returns all six horizons in order", () => {
    expect(fan.map((f) => f.horizon)).toEqual(["1m", "2m", "3m", "6m", "12m", "18m"]);
    expect(fan.map((f) => f.months)).toEqual([1, 2, 3, 6, 12, 18]);
  });

  test("expected return is the probability-weighted mean of the cases", () => {
    const oneMonth = fan[0];
    expect(oneMonth?.expected).toBeCloseTo(0.3 * 0.08 + 0.5 * 0.01 + 0.2 * -0.09, 10);
  });

  test("the mixture band spans the cases without exceeding their own tails", () => {
    const oneMonth = fan[0];
    expect(oneMonth?.p10).not.toBeNull();
    expect(oneMonth?.p90).not.toBeNull();
    expect(oneMonth?.p10 as number).toBeGreaterThanOrEqual(-0.2);
    expect(oneMonth?.p90 as number).toBeLessThanOrEqual(0.15);
    expect(oneMonth?.p10 as number).toBeLessThan(oneMonth?.p50 as number);
    expect(oneMonth?.p50 as number).toBeLessThan(oneMonth?.p90 as number);
  });

  test("a horizon nobody projected is null everywhere, not zero", () => {
    const threeMonth = fan.find((f) => f.horizon === "3m");
    expect(threeMonth?.expected).toBeNull();
    expect(threeMonth?.p10).toBeNull();
    expect(threeMonth?.contributors).toBe(0);
  });

  test("counts contributing cases and mixes the price fan separately", () => {
    const oneMonth = fan[0];
    expect(oneMonth?.contributors).toBe(3);
    expect(oneMonth?.pricep50).not.toBeNull();
    expect(oneMonth?.pricep50 as number).toBeGreaterThan(168);
    expect(oneMonth?.pricep50 as number).toBeLessThan(200);
  });
});

describe("densityCurve", () => {
  test("builds a normalised mixture shape with one mark per case", () => {
    const density = densityCurve(scenarios, "1m", 40);
    expect(density).not.toBeNull();
    if (!density) return;
    expect(density.points).toHaveLength(41);
    expect(Math.max(...density.points.map((p) => p.y))).toBeCloseTo(1, 10);
    expect(density.marks.map((m) => m.key).sort()).toEqual(["bear", "bull", "neutral"]);
    expect(density.min).toBeLessThan(-0.09);
    expect(density.max).toBeGreaterThan(0.08);
  });

  test("returns null when no case projected the horizon", () => {
    expect(densityCurve(scenarios, "6m")).toBeNull();
    expect(densityCurve(null, "1m")).toBeNull();
  });
});

describe("entryBand", () => {
  test("places the current price on the drawn axis and names the zone", () => {
    const band = entryBand({
      bargain_below: 150,
      fair_value: 180,
      expensive_above: 210,
      current_price: 180,
    });
    expect(band.zone).toBe("fair");
    expect(band.t).toBeCloseTo(0.5, 6);
    expect(band.vsFair).toBeCloseTo(0, 10);
    expect(band.axisMin as number).toBeLessThan(150);
    expect(band.axisMax as number).toBeGreaterThan(210);
  });

  test("bargain and expensive are inclusive of their thresholds", () => {
    expect(entryBand({ bargain_below: 150, expensive_above: 210, current_price: 150 }).zone).toBe(
      "bargain",
    );
    expect(entryBand({ bargain_below: 150, expensive_above: 210, current_price: 210 }).zone).toBe(
      "expensive",
    );
  });

  test("derives current-vs-fair when the engine omitted it", () => {
    const band = entryBand({ fair_value: 200, current_price: 220, bargain_below: 170 });
    expect(band.vsFair).toBeCloseTo(0.1, 10);
  });

  test("degrades to an unplottable band rather than inventing an axis", () => {
    const band = entryBand({ current_price: 180 });
    expect(band.t).toBeNull();
    expect(band.axisMin).toBeNull();
    expect(band.zone).toBeNull();
    expect(entryBand(null).current).toBeNull();
  });
});

describe("normalizeWeights", () => {
  test("sorts by share and drops non-positive weights", () => {
    const rows = normalizeWeights({ regime: 0.3, macro: 0.1, broken: null, zero: 0, neg: -1 });
    expect(rows.map((r) => r.key)).toEqual(["regime", "macro"]);
    expect(rows[0]?.share).toBeCloseTo(0.75, 10);
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 10);
  });

  test("empty input is an empty list", () => {
    expect(normalizeWeights(null)).toEqual([]);
  });
});

describe("exitLadder", () => {
  test("derives the implied return against the current price", () => {
    const rows = exitLadder(
      [
        { horizon: "3m", price: 220, probability: 0.55 },
        { horizon: "12m", price: null, probability: null },
      ],
      200,
    );
    expect(rows[0]?.ret).toBeCloseTo(0.1, 10);
    expect(rows[1]?.ret).toBeNull();
    expect(rows[1]?.horizon).toBe("12m");
  });

  test("no current price means no derived return", () => {
    expect(exitLadder([{ horizon: "3m", price: 220 }], null)[0]?.ret).toBeNull();
    expect(exitLadder(null, 100)).toEqual([]);
  });
});

describe("exitLadder basis", () => {
  test("carries the engine's own description of what the price is", () => {
    // Live NVDA packet shape: derive_targets copies the BULL case's
    // `price_p50` and that case's probability, and says so in `basis`.
    const rows = exitLadder(
      [
        {
          horizon: "12m",
          price: 591.9,
          probability: 0.2675,
          basis: "bull-case median price at this horizon",
        },
      ],
      217.5,
    );
    expect(rows[0]?.basis).toBe("bull-case median price at this horizon");
    // The probability is the bull case's, not the odds on the price. The UI
    // labels it "bull case 27%"; nothing here converts it into a hit rate.
    expect(rows[0]?.probability).toBeCloseTo(0.2675, 10);
  });

  test("a missing or blank basis is null, never invented", () => {
    expect(exitLadder([{ horizon: "3m", price: 220 }], 200)[0]?.basis).toBeNull();
    expect(exitLadder([{ horizon: "3m", price: 220, basis: "  " }], 200)[0]?.basis).toBeNull();
    expect(exitLadder([{ horizon: "3m", price: 220, basis: 5 }], 200)[0]?.basis).toBeNull();
  });
});

describe("ladderBasis", () => {
  const basis = "bull-case median price at this horizon";

  test("returns the one basis the rungs agree on", () => {
    expect(ladderBasis([{ basis }, { basis }, { basis: null }])).toBe(basis);
  });

  test("says nothing when the rungs disagree or none has a basis", () => {
    expect(ladderBasis([{ basis }, { basis: "neutral-case median" }])).toBeNull();
    expect(ladderBasis([{ basis: null }, { basis: null }])).toBeNull();
    expect(ladderBasis([])).toBeNull();
  });
});

describe("weightEvidence", () => {
  // Verbatim from the live NVDA packet's scenarios.weight_evidence.
  const live = {
    method: "walk_forward_out_of_sample_r2",
    reason: "no component beat the naive constant forecast out of sample",
    fallback: "relative_skill_ranking",
    fallback_note: "…weights rank components by skill relative to the worst performer…",
    prior_only_components: ["factors", "spectral", "fundamentals", "macro"],
    unscored_prior_mass: 0.6,
    components: { seasonality: { skill: -0.3 }, regime: { skill: -0.05 } },
  };

  test("reads the engine's own audit of its weights", () => {
    const read = weightEvidence({ weight_evidence: live });
    expect(read?.fallback).toBe("relative_skill_ranking");
    expect(read?.reason).toBe("no component beat the naive constant forecast out of sample");
    expect(read?.priorOnly).toEqual(["factors", "spectral", "fundamentals", "macro"]);
    expect(read?.unscoredPriorMass).toBeCloseTo(0.6, 10);
  });

  test("a measured run reports no fallback", () => {
    const read = weightEvidence({
      weight_evidence: {
        method: "walk_forward_out_of_sample_r2",
        components: { regime: { skill: 0.04 } },
        prior_only_components: [],
        unscored_prior_mass: 0,
      },
    });
    expect(read?.fallback).toBeNull();
    expect(read?.priorOnly).toEqual([]);
  });

  test("falls back to fallback_note when there is no reason, and survives junk", () => {
    expect(
      weightEvidence({ weight_evidence: { fallback: "x", fallback_note: "why" } })?.reason,
    ).toBe("why");
    expect(
      weightEvidence({
        // Deliberately off-contract: the reader must survive an engine that
        // ships a shape the types do not describe.
        weight_evidence: { prior_only_components: [1, "macro", ""] } as never,
      })?.priorOnly,
    ).toEqual(["macro"]);
    expect(weightEvidence({ weight_evidence: null })).toBeNull();
    expect(weightEvidence(null)).toBeNull();
    expect(weightEvidence({})).toBeNull();
  });

  test("an unscored mass that is not a number stays null rather than zero", () => {
    const read = weightEvidence({ weight_evidence: { unscored_prior_mass: "0.6" } as never });
    expect(read?.unscoredPriorMass).toBeNull();
  });
});

describe("component shrinkage", () => {
  test("reads per-horizon and flat numbers alike", () => {
    expect(numberAtHorizon({ "1m": 0.01, "3m": 0.04 }, "3m")).toBeCloseTo(0.04, 10);
    expect(numberAtHorizon(0.07, "3m")).toBeCloseTo(0.07, 10);
    expect(numberAtHorizon({ "1m": 0.01 }, "3m")).toBeNull();
    expect(numberAtHorizon("0.04", "3m")).toBeNull();
    expect(numberAtHorizon(null, "3m")).toBeNull();
  });

  test("raw and shrunk are reported per component, with the prior weight", () => {
    const rows = shrinkageRows(
      {
        components: {
          seasonality: {
            component: "seasonality",
            shrinkage: {
              raw_expected_return: { "3m": 0.1269 },
              prior: { "3m": 0.02 },
              shrink_weight: { "3m": 0.6 },
              expected_return: { "3m": 0.0629 },
            },
          },
          regime: {
            component: "regime",
            shrinkage: { raw_expected_return: 0.17, expected_return: 0.09, shrink_weight: 0.4 },
          },
        },
      } as PrismScenarios,
      "3m",
    );
    expect(rows.map((r) => r.key)).toEqual(["seasonality", "regime"]);
    expect(rows[0]?.raw).toBeCloseTo(0.1269, 10);
    expect(rows[0]?.prior).toBeCloseTo(0.02, 10);
    expect(rows[0]?.shrunk).toBeCloseTo(0.0629, 10);
    expect(rows[0]?.weight).toBeCloseTo(0.6, 10);
    expect(rows[0]?.clamped).toBe(false);
    expect(rows[1]?.prior).toBeNull();
  });

  test("a shrunk value sitting on its own bound is marked as clamped", () => {
    const bounded = (clamp_bounds: unknown) =>
      shrinkageRows(
        {
          components: {
            spectral: {
              shrinkage: { raw_expected_return: 1.4, expected_return: 0.6 },
              clamp_bounds,
            },
          },
        } as PrismScenarios,
        "6m",
      )[0];
    expect(bounded([-0.6, 0.6])?.clamped).toBe(true);
    expect(bounded({ low: -0.6, high: 0.6 })?.clamped).toBe(true);
    expect(bounded({ min: -0.6, max: 0.6 })?.clamped).toBe(true);
    expect(bounded({ "6m": [-0.6, 0.6] })?.clamped).toBe(true);
    expect(bounded([-0.9, 0.9])?.clamped).toBe(false);
    expect(bounded(undefined)?.clamped).toBe(false);
    expect(bounded([-0.6, 0.6])?.hi).toBeCloseTo(0.6, 10);
  });

  test("a packet without the recalibration renders no shrinkage block at all", () => {
    expect(shrinkageRows(scenarios, "3m")).toEqual([]);
    expect(shrinkageRows(null, "3m")).toEqual([]);
    // A component with an empty shrinkage block is not evidence of anything.
    expect(
      shrinkageRows(
        { components: { macro: { shrinkage: { shrink_weight: 0.5 } } } } as PrismScenarios,
        "3m",
      ),
    ).toEqual([]);
    expect(shrinkageRows({ components: { macro: null } } as PrismScenarios, "3m")).toEqual([]);
  });
});
