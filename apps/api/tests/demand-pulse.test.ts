import { describe, expect, test } from "bun:test";
import { type CompanyEdge, DemandPulse, type Source } from "@mapvest/core";
import {
  type FundamentalsByTicker,
  buyerEdges,
  computeDemandPulse,
  yoyPercent,
} from "../src/lib/demand-pulse.js";

/**
 * Pure-function coverage for the demand pulse: YoY derivation, buyer selection,
 * weighting, and every `interpretation` branch. No network, no POSTGRES_URL —
 * `computeDemandPulse` takes edges and fundamentals as plain values, so the
 * whole math surface is exercised offline.
 */

const SOURCE: Source = {
  provider: "massive",
  url: "https://api.massive.com/stocks/financials/v1/income-statements?ticker=MSFT",
  fetchedAt: "2026-08-20T00:00:00.000Z",
  confidence: "high",
};

function edge(partial: Partial<CompanyEdge> & { dstName: string }): CompanyEdge {
  return {
    id: crypto.randomUUID(),
    srcTicker: "NVDA",
    dstTicker: undefined,
    dstName: partial.dstName,
    edgeType: "buys_from",
    weight: 0.5,
    reasoning: "10-K item 1 customer concentration",
    sources: [SOURCE],
    asOf: "2026-01-31",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

/** Annual income + cash-flow statements, newest first, from explicit numbers. */
function fundamentals(input: {
  name?: string;
  revenue?: [latest: number, priorYear: number];
  capex?: [latest: number, priorYear: number];
}): FundamentalsByTicker[string] {
  const latestDate = "2026-06-30";
  const priorDate = "2025-06-30";
  return {
    name: input.name,
    income: input.revenue
      ? [
          { ticker: "X", period: "FY2026", fiscalDate: latestDate, revenue: input.revenue[0] },
          { ticker: "X", period: "FY2025", fiscalDate: priorDate, revenue: input.revenue[1] },
        ]
      : [],
    cashFlow: input.capex
      ? [
          { ticker: "X", period: "FY2026", fiscalDate: latestDate, capex: input.capex[0] },
          { ticker: "X", period: "FY2025", fiscalDate: priorDate, capex: input.capex[1] },
        ]
      : [],
    sources: [SOURCE],
  };
}

describe("yoyPercent", () => {
  test("compares the newest period against the one ~a year earlier", () => {
    const pct = yoyPercent([
      { period: "FY2026", fiscalDate: "2026-06-30", value: 110 },
      { period: "FY2025", fiscalDate: "2025-06-30", value: 100 },
    ]);
    expect(pct).toBeCloseTo(10, 6);
  });

  test("skips intervening quarters and matches the same quarter a year back", () => {
    const pct = yoyPercent([
      { period: "Q2", fiscalDate: "2026-06-30", value: 125 },
      { period: "Q1", fiscalDate: "2026-03-31", value: 118 },
      { period: "Q4", fiscalDate: "2025-12-31", value: 112 },
      { period: "Q3", fiscalDate: "2025-09-30", value: 105 },
      { period: "Q2", fiscalDate: "2025-06-30", value: 100 },
    ]);
    expect(pct).toBeCloseTo(25, 6);
  });

  test("sorts unordered input before comparing", () => {
    const pct = yoyPercent([
      { period: "FY2025", fiscalDate: "2025-06-30", value: 200 },
      { period: "FY2026", fiscalDate: "2026-06-30", value: 180 },
    ]);
    expect(pct).toBeCloseTo(-10, 6);
  });

  test("returns undefined — never 0 — when no prior period is a year back", () => {
    expect(
      yoyPercent([
        { period: "Q2", fiscalDate: "2026-06-30", value: 125 },
        { period: "Q1", fiscalDate: "2026-03-31", value: 118 },
      ]),
    ).toBeUndefined();
    expect(
      yoyPercent([{ period: "FY2026", fiscalDate: "2026-06-30", value: 125 }]),
    ).toBeUndefined();
    expect(yoyPercent([])).toBeUndefined();
  });

  test("refuses a non-positive base period rather than emitting an infinity", () => {
    expect(
      yoyPercent([
        { period: "FY2026", fiscalDate: "2026-06-30", value: 50 },
        { period: "FY2025", fiscalDate: "2025-06-30", value: 0 },
      ]),
    ).toBeUndefined();
  });
});

describe("buyerEdges", () => {
  test("keeps only buys_from edges that carry a real ticker, heaviest first", () => {
    const edges = [
      edge({ dstName: "Microsoft", dstTicker: "MSFT", weight: 0.6 }),
      edge({ dstName: "Meta", dstTicker: "META", weight: 0.9 }),
      edge({ dstName: "Taiwan Semiconductor", dstTicker: "TSM", edgeType: "supplies", weight: 1 }),
      edge({ dstName: "AMD", dstTicker: "AMD", edgeType: "competes_with", weight: 1 }),
      // Private buyer — no ticker was invented for it upstream, so it has no
      // fundamentals to join and is not a pulse constituent.
      edge({ dstName: "A Private Cloud Operator", weight: 0.8 }),
    ];
    expect(buyerEdges(edges).map((e) => e.dstTicker)).toEqual(["META", "MSFT"]);
  });

  test("dedupes a repeated buyer keeping the heaviest edge", () => {
    const edges = [
      edge({ dstName: "Microsoft", dstTicker: "MSFT", weight: 0.3 }),
      edge({ dstName: "Microsoft Corp", dstTicker: "msft", weight: 0.85 }),
    ];
    const result = buyerEdges(edges);
    expect(result).toHaveLength(1);
    expect(result[0]!.weight).toBe(0.85);
  });
});

describe("computeDemandPulse", () => {
  test("weights buyer signals by edge weight and reads expanding", () => {
    const edges = [
      edge({ dstName: "Microsoft", dstTicker: "MSFT", weight: 0.75 }),
      edge({ dstName: "Meta", dstTicker: "META", weight: 0.25 }),
    ];
    const funds: FundamentalsByTicker = {
      MSFT: fundamentals({ name: "Microsoft", revenue: [120, 100] }), // +20%
      META: fundamentals({ name: "Meta", revenue: [104, 100] }), // +4%
    };

    const result = computeDemandPulse(edges, funds);
    // 0.75 * 20 + 0.25 * 4 = 16
    expect(result.pulse).toBeCloseTo(16, 6);
    expect(result.interpretation).toBe("expanding");
    expect(result.buyers.map((b) => b.ticker)).toEqual(["MSFT", "META"]);
    expect(result.buyers[0]!.weight).toBeCloseTo(0.75, 6);
    expect(result.buyers[0]!.revenueYoY).toBeCloseTo(20, 6);
    expect(result.buyers[0]!.capexYoY).toBeUndefined();
  });

  test("blends revenue and capex growth when both resolve", () => {
    const edges = [edge({ dstName: "Microsoft", dstTicker: "MSFT", weight: 1 })];
    const funds: FundamentalsByTicker = {
      MSFT: fundamentals({ revenue: [110, 100], capex: [150, 100] }), // +10% and +50%
    };

    const result = computeDemandPulse(edges, funds);
    expect(result.buyers[0]!.revenueYoY).toBeCloseTo(10, 6);
    expect(result.buyers[0]!.capexYoY).toBeCloseTo(50, 6);
    expect(result.pulse).toBeCloseTo(30, 6); // mean of the two components
    expect(result.interpretation).toBe("expanding");
  });

  test("moves when only the capex series moves (roadmap C3 acceptance)", () => {
    const edges = [edge({ dstName: "Microsoft", dstTicker: "MSFT", weight: 1 })];
    const flat = computeDemandPulse(edges, {
      MSFT: fundamentals({ revenue: [100, 100], capex: [100, 100] }),
    });
    const capexUp = computeDemandPulse(edges, {
      MSFT: fundamentals({ revenue: [100, 100], capex: [140, 100] }),
    });
    expect(flat.pulse).toBeCloseTo(0, 6);
    expect(flat.interpretation).toBe("mixed");
    expect(capexUp.pulse).toBeCloseTo(20, 6);
    expect(capexUp.interpretation).toBe("expanding");
  });

  test("reads contracting below the negative threshold", () => {
    const edges = [edge({ dstName: "Meta", dstTicker: "META", weight: 0.4 })];
    const result = computeDemandPulse(edges, {
      META: fundamentals({ revenue: [88, 100] }), // -12%
    });
    expect(result.pulse).toBeCloseTo(-12, 6);
    expect(result.interpretation).toBe("contracting");
  });

  test("reads mixed inside the +/-3 band, at either edge", () => {
    const edges = [edge({ dstName: "Meta", dstTicker: "META", weight: 1 })];
    expect(
      computeDemandPulse(edges, { META: fundamentals({ revenue: [103, 100] }) }),
    ).toMatchObject({ interpretation: "mixed" });
    expect(computeDemandPulse(edges, { META: fundamentals({ revenue: [97, 100] }) })).toMatchObject(
      {
        interpretation: "mixed",
      },
    );
    // Just past the boundary flips out of mixed.
    expect(
      computeDemandPulse(edges, { META: fundamentals({ revenue: [103.5, 100] }) }).interpretation,
    ).toBe("expanding");
  });

  test("offsetting buyers land in mixed rather than pretending to a direction", () => {
    const edges = [
      edge({ dstName: "Microsoft", dstTicker: "MSFT", weight: 0.5 }),
      edge({ dstName: "Meta", dstTicker: "META", weight: 0.5 }),
    ];
    const result = computeDemandPulse(edges, {
      MSFT: fundamentals({ revenue: [120, 100] }), // +20%
      META: fundamentals({ revenue: [80, 100] }), // -20%
    });
    expect(result.pulse).toBeCloseTo(0, 6);
    expect(result.interpretation).toBe("mixed");
  });

  test("pulse is null and unknown when there are no edges at all", () => {
    const result = computeDemandPulse([], {});
    expect(result.pulse).toBeNull();
    expect(result.interpretation).toBe("unknown");
    expect(result.buyers).toEqual([]);
  });

  test("pulse is null — not 0 — when no buyer's fundamentals resolve", () => {
    const edges = [
      edge({ dstName: "Microsoft", dstTicker: "MSFT", weight: 0.7 }),
      edge({ dstName: "A Private Cloud Operator", weight: 0.9 }),
    ];
    const result = computeDemandPulse(edges, {});
    expect(result.pulse).toBeNull();
    expect(result.interpretation).toBe("unknown");
    // The listed buyer is still reported, at weight 0, with no invented YoY.
    expect(result.buyers).toEqual([{ ticker: "MSFT", name: "Microsoft", weight: 0 }]);
  });

  test("normalizes weights across resolved buyers only", () => {
    const edges = [
      edge({ dstName: "Microsoft", dstTicker: "MSFT", weight: 0.6 }),
      edge({ dstName: "Meta", dstTicker: "META", weight: 0.4 }),
      edge({ dstName: "Amazon", dstTicker: "AMZN", weight: 0.9 }),
    ];
    // AMZN has no fundamentals; MSFT/META split 0.6/0.4 of the remaining weight.
    const result = computeDemandPulse(edges, {
      MSFT: fundamentals({ revenue: [110, 100] }),
      META: fundamentals({ revenue: [110, 100] }),
    });
    const byTicker = Object.fromEntries(result.buyers.map((b) => [b.ticker, b]));
    expect(byTicker.AMZN!.weight).toBe(0);
    expect(byTicker.AMZN!.revenueYoY).toBeUndefined();
    expect(byTicker.MSFT!.weight).toBeCloseTo(0.6, 6);
    expect(byTicker.META!.weight).toBeCloseTo(0.4, 6);
    expect(byTicker.MSFT!.weight + byTicker.META!.weight).toBeCloseTo(1, 6);
    expect(result.pulse).toBeCloseTo(10, 6);
  });

  test("falls back to an equal split when every edge weight is zero", () => {
    const edges = [
      edge({ dstName: "Microsoft", dstTicker: "MSFT", weight: 0 }),
      edge({ dstName: "Meta", dstTicker: "META", weight: 0 }),
    ];
    const result = computeDemandPulse(edges, {
      MSFT: fundamentals({ revenue: [120, 100] }), // +20%
      META: fundamentals({ revenue: [100, 100] }), // 0%
    });
    for (const buyer of result.buyers) expect(buyer.weight).toBeCloseTo(0.5, 6);
    expect(result.pulse).toBeCloseTo(10, 6);
    expect(result.interpretation).toBe("expanding");
  });

  test("a buyer with statements but no comparable prior period does not resolve", () => {
    const edges = [edge({ dstName: "Microsoft", dstTicker: "MSFT", weight: 1 })];
    const result = computeDemandPulse(edges, {
      MSFT: {
        name: "Microsoft",
        income: [{ ticker: "MSFT", period: "FY2026", fiscalDate: "2026-06-30", revenue: 120 }],
        cashFlow: [],
      },
    });
    expect(result.pulse).toBeNull();
    expect(result.interpretation).toBe("unknown");
    expect(result.buyers[0]!.revenueYoY).toBeUndefined();
  });

  test("output satisfies the core DemandPulse schema", () => {
    const edges = [edge({ dstName: "Microsoft", dstTicker: "MSFT", weight: 0.7 })];
    const computed = computeDemandPulse(edges, {
      MSFT: fundamentals({ name: "Microsoft", revenue: [130, 100], capex: [150, 100] }),
    });
    const parsed = DemandPulse.parse({
      ticker: "NVDA",
      buyers: computed.buyers,
      pulse: computed.pulse,
      interpretation: computed.interpretation,
      generatedAt: new Date().toISOString(),
      sources: [SOURCE],
    });
    expect(parsed.interpretation).toBe("expanding");
    expect(parsed.buyers[0]!.weight).toBeCloseTo(1, 6);
    expect(parsed.sources[0]!.provider).toBe("massive");
  });
});
