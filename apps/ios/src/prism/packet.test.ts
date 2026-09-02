/**
 * Contract tests for the two packet shapes the screen must survive: a packet
 * where every analytical section failed, and one where they all landed.
 *
 * The first is the important one. The engine is explicitly allowed to return
 * `null` for any section with a sibling `<section>_error`, and this screen's
 * promise is that such a section still renders — as a card that names the
 * reason — instead of disappearing or showing a fabricated zero.
 */
import { describe, expect, test } from "bun:test";
import type { PrismPacket, PrismSectionKey } from "@/api/prism";
import { sectionUnavailable } from "./format";
import {
  caseProbabilities,
  densityCurve,
  entryBand,
  horizonFan,
  normalizeWeights,
} from "./scenario";
import {
  cycleNodes,
  keyLevelRows,
  macroTiles,
  quarterSeries,
  reconstructWave,
  regimePosterior,
  regimeRuns,
  relationalRows,
  seasonalityRows,
  smileCurve,
  yieldCurvePoints,
} from "./signals";

const SECTION_KEYS: PrismSectionKey[] = [
  "profile",
  "seasonality",
  "macro",
  "relational",
  "factors",
  "regimes",
  "entropy",
  "spectral",
  "eigen",
  "fundamentals",
  "filings",
  "volatility",
  "levels",
  "news",
  "recent",
  "scenarios",
  "memo",
];

const emptyPacket: PrismPacket = {
  ticker: "MU",
  as_of: "2026-09-01",
  generated_at: "2026-09-01T12:00:00Z",
  engine_version: "1.0.0",
  profile: null,
  universe: [],
  seasonality: null,
  macro: null,
  relational: null,
  factors: null,
  regimes: null,
  entropy: null,
  spectral: null,
  eigen: null,
  fundamentals: null,
  filings: null,
  volatility: null,
  levels: null,
  news: null,
  recent: null,
  scenarios: null,
  memo: null,
  sources: [],
  meta: {
    errors: [
      { source: "seasonality", error: "only 14 months of history" },
      { source: "filings", error: "SEC EDGAR returned 403" },
    ],
    source_status: {},
    timings_ms: {},
    cache: {},
  },
  macro_error: "FRED request timed out",
};

describe("a packet where everything failed", () => {
  test("every section reports a reason rather than rendering blank", () => {
    for (const key of SECTION_KEYS) {
      const reason = sectionUnavailable(emptyPacket, key, emptyPacket[key]);
      expect(reason).not.toBeNull();
      expect((reason as string).length).toBeGreaterThan(0);
    }
  });

  test("reasons come from the section sibling first, then the meta ledger", () => {
    expect(sectionUnavailable(emptyPacket, "macro", emptyPacket.macro)).toBe(
      "FRED request timed out",
    );
    expect(sectionUnavailable(emptyPacket, "seasonality", emptyPacket.seasonality)).toBe(
      "only 14 months of history",
    );
    expect(sectionUnavailable(emptyPacket, "spectral", emptyPacket.spectral)).toBe(
      "the engine did not return this section",
    );
  });

  test("every derivation degrades to empty instead of throwing or inventing", () => {
    expect(seasonalityRows(emptyPacket.seasonality, "MU")).toEqual([]);
    expect(relationalRows(emptyPacket.relational)).toEqual([]);
    expect(regimeRuns(emptyPacket.regimes)).toEqual([]);
    expect(regimePosterior(emptyPacket.regimes)).toEqual([]);
    expect(cycleNodes(emptyPacket.spectral?.modes)).toEqual([]);
    expect(reconstructWave(emptyPacket.spectral?.modes).points).toEqual([]);
    expect(yieldCurvePoints(emptyPacket.macro)).toEqual([]);
    expect(macroTiles(emptyPacket.macro)).toEqual([]);
    expect(smileCurve(emptyPacket.volatility)).toEqual([]);
    expect(keyLevelRows(emptyPacket.levels, null)).toEqual([]);
    expect(quarterSeries(emptyPacket.fundamentals?.quarters, "revenue").values).toEqual([]);
    expect(normalizeWeights(emptyPacket.scenarios?.weights)).toEqual([]);
    expect(densityCurve(emptyPacket.scenarios, "3m")).toBeNull();
  });

  test("the horizon strip still returns all six slots, all null", () => {
    const fan = horizonFan(emptyPacket.scenarios);
    expect(fan).toHaveLength(6);
    expect(fan.every((p) => p.expected === null && p.p10 === null && p.p90 === null)).toBe(true);
    expect(fan.every((p) => p.contributors === 0)).toBe(true);
  });

  test("probabilities are zero, never NaN, and the entry band is unplottable", () => {
    for (const row of caseProbabilities(emptyPacket.scenarios)) {
      expect(Number.isFinite(row.probability)).toBe(true);
      expect(row.probability).toBe(0);
    }
    const band = entryBand(emptyPacket.scenarios?.entry);
    expect(band.t).toBeNull();
    expect(band.zone).toBeNull();
  });
});

describe("a packet where everything landed", () => {
  const packet: PrismPacket = {
    ...emptyPacket,
    ticker: "NVDA",
    profile: { name: "NVIDIA", sector: "Technology", related_etfs: ["SOXX", "QQQ"] },
    seasonality: {
      month: 9,
      month_label: "September",
      ticker: { this_month: { "5y": { mean: 0.03, hit_rate: 0.6, n: 5 } } },
      benchmarks: { SPY: { this_month: { "5y": { mean: -0.01, hit_rate: 0.4, n: 5 } } } },
    },
    macro: { yields: { DGS2: { current: 3.8 }, DGS10: { current: 4.2 } }, vix: { current: 16 } },
    relational: { correlation: { SPY: { "1y": 0.6 } }, beta: { SPY: { "1y": 1.7 } } },
    regimes: {
      states: [{ id: 0, label: "bull" }],
      current: { state: 0, label: "bull", posterior: [1] },
      history: [{ date: "2026-08-31", state: 0 }],
    },
    scenarios: {
      weights: { regime: 0.6, macro: 0.4 },
      cases: {
        bull: {
          probability: 0.4,
          narrative: "b",
          horizons: { "3m": { expected_return: 0.1, p10: 0.02, p50: 0.1, p90: 0.2 } },
        },
        neutral: {
          probability: 0.4,
          narrative: "n",
          horizons: { "3m": { expected_return: 0.01, p10: -0.05, p50: 0.01, p90: 0.06 } },
        },
        bear: {
          probability: 0.2,
          narrative: "x",
          horizons: { "3m": { expected_return: -0.1, p10: -0.2, p50: -0.1, p90: -0.02 } },
        },
      },
      entry: { bargain_below: 150, fair_value: 180, expensive_above: 210, current_price: 160 },
    },
    meta: { errors: [], source_status: {}, timings_ms: {}, cache: { macro: "hit" } },
    macro_error: undefined,
  };

  test("no section reports as unavailable", () => {
    const present: PrismSectionKey[] = [
      "profile",
      "seasonality",
      "macro",
      "relational",
      "regimes",
      "scenarios",
    ];
    for (const key of present) {
      expect(sectionUnavailable(packet, key, packet[key])).toBeNull();
    }
  });

  test("the derivations produce the rows the charts need", () => {
    expect(seasonalityRows(packet.seasonality, packet.ticker).map((r) => r.symbol)).toEqual([
      "NVDA",
      "SPY",
    ]);
    expect(relationalRows(packet.relational)[0]?.beta1y).toBeCloseTo(1.7, 10);
    expect(regimeRuns(packet.regimes)[0]?.label).toBe("bull");
    expect(yieldCurvePoints(packet.macro)).toHaveLength(2);
    expect(macroTiles(packet.macro).map((t) => t.key)).toEqual(["vix"]);
    expect(normalizeWeights(packet.scenarios?.weights)[0]?.key).toBe("regime");
  });

  test("the 3m horizon mixes and the entry band places the price in the bargain half", () => {
    const point = horizonFan(packet.scenarios).find((p) => p.horizon === "3m");
    expect(point?.contributors).toBe(3);
    expect(point?.expected).toBeCloseTo(0.4 * 0.1 + 0.4 * 0.01 + 0.2 * -0.1, 10);
    const band = entryBand(packet.scenarios?.entry);
    expect(band.zone).toBe("fair");
    expect(band.t as number).toBeLessThan(0.5);
    expect(densityCurve(packet.scenarios, "3m")).not.toBeNull();
  });
});
