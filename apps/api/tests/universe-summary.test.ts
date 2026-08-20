import { describe, expect, test } from "bun:test";
import { type Find, type Quote, UniverseSummary } from "@mapvest/core";
import { computeUniverseSummary, effectiveTicker } from "../src/lib/universe-summary.js";

/**
 * Pure-function tests for the counterfactual universe portfolio (Universe
 * Roadmap §1 A3). Offline only — `computeUniverseSummary` takes finds and a
 * pre-fetched quote map, so nothing here touches the network or Postgres.
 *
 * The load-bearing rule under test is AGENTS.md §2.4: a find without a usable
 * `foundPrice` or without a quote for its effective ticker is EXCLUDED from the
 * valued set, never estimated.
 */

let seq = 0;
function find(partial: Partial<Find> & { brand: string }): Find {
  seq += 1;
  return {
    id: `f_${seq}`,
    confidence: "high",
    createdAt: new Date(Date.UTC(2026, 0, seq)).toISOString(),
    ...partial,
  };
}

function quote(partial: Partial<Quote> & { symbol: string; price: number }): Quote {
  return {
    change: 0,
    changePct: 0,
    currency: "USD",
    ts: "2026-08-19T15:00:00.000Z",
    disclaimer: "Delayed market data.",
    provider: "massive",
    ...partial,
  };
}

function quoteMap(...quotes: Quote[]): Map<string, Quote> {
  return new Map(quotes.map((q) => [q.symbol, q]));
}

describe("effectiveTicker", () => {
  test("prefers the find's own ticker, falls back to the comparable", () => {
    expect(effectiveTicker(find({ brand: "Hershey", ticker: "HSY" }))).toBe("HSY");
    expect(effectiveTicker(find({ brand: "Blue Bottle", comparable: "SBUX" }))).toBe("SBUX");
    expect(effectiveTicker(find({ brand: "Blue Bottle", ticker: "HSY", comparable: "SBUX" }))).toBe(
      "HSY",
    );
  });

  test("treats a missing or blank symbol as unvaluable", () => {
    expect(effectiveTicker(find({ brand: "Corner Bodega" }))).toBeUndefined();
    expect(effectiveTicker(find({ brand: "Corner Bodega", ticker: "   " }))).toBeUndefined();
  });
});

describe("computeUniverseSummary", () => {
  test("mixed universe: exact math over the valued finds only", () => {
    const finds = [
      // winner, public: $100 at 100.00 → 125.00
      find({ brand: "Church & Dwight", ticker: "CHD", isPublic: true, foundPrice: 100 }),
      // loser, private via comparable: $100 at 80.00 → 50.00
      find({ brand: "Blue Bottle", isPublic: false, comparable: "SBUX", foundPrice: 80 }),
      // excluded: no foundPrice recorded at identify time
      find({ brand: "Nintendo", ticker: "NTDOY", isPublic: true }),
      // excluded: foundPrice, but no quote came back for the symbol
      find({ brand: "Hershey", ticker: "HSY", isPublic: true, foundPrice: 190 }),
      // excluded: neither ticker nor comparable resolved
      find({ brand: "Corner Bodega", isPublic: false, foundPrice: 12 }),
    ];
    const quotes = quoteMap(
      quote({ symbol: "CHD", price: 125 }),
      quote({ symbol: "SBUX", price: 40 }),
      // A quote for a symbol nobody found must not leak into the aggregate.
      quote({ symbol: "TSLA", price: 400 }),
    );

    const summary = computeUniverseSummary(finds, quotes);

    expect(summary.findCount).toBe(5);
    expect(summary.valuedFinds).toBe(2);
    expect(summary.hypotheticalBasis).toBe(200);
    expect(summary.hypotheticalValue).toBe(175);
    expect(summary.changePct).toBeCloseTo(-12.5, 10);
    expect(UniverseSummary.parse(summary)).toBeTruthy();
  });

  test("a private brand is valued against its comparable's quote", () => {
    const finds = [
      find({ brand: "Blue Bottle", isPublic: false, comparable: "SBUX", foundPrice: 50 }),
    ];
    const summary = computeUniverseSummary(finds, quoteMap(quote({ symbol: "SBUX", price: 75 })));

    expect(summary.valuedFinds).toBe(1);
    expect(summary.hypotheticalBasis).toBe(100);
    expect(summary.hypotheticalValue).toBeCloseTo(150, 10);
    expect(summary.changePct).toBeCloseTo(50, 10);
  });

  test("non-round ratios accumulate at full precision", () => {
    const finds = [
      find({ brand: "A", ticker: "AAA", foundPrice: 3 }),
      find({ brand: "B", ticker: "BBB", foundPrice: 7 }),
    ];
    const quotes = quoteMap(quote({ symbol: "AAA", price: 4 }), quote({ symbol: "BBB", price: 6 }));

    const expected = 100 * (4 / 3) + 100 * (6 / 7);
    const summary = computeUniverseSummary(finds, quotes);

    expect(summary.hypotheticalBasis).toBe(200);
    expect(summary.hypotheticalValue).toBeCloseTo(expected, 10);
    expect(summary.changePct).toBeCloseTo(((expected - 200) / 200) * 100, 10);
  });

  test("a zero, negative, or non-finite foundPrice is excluded, never estimated", () => {
    const finds = [
      find({ brand: "Zero", ticker: "ZZZ", foundPrice: 0 }),
      find({ brand: "Negative", ticker: "NNN", foundPrice: -10 }),
      find({ brand: "NaN", ticker: "XXX", foundPrice: Number.NaN }),
      find({ brand: "Good", ticker: "GGG", foundPrice: 10 }),
    ];
    const quotes = quoteMap(
      quote({ symbol: "ZZZ", price: 5 }),
      quote({ symbol: "NNN", price: 5 }),
      quote({ symbol: "XXX", price: 5 }),
      quote({ symbol: "GGG", price: 20 }),
    );

    const summary = computeUniverseSummary(finds, quotes);

    expect(summary.findCount).toBe(4);
    expect(summary.valuedFinds).toBe(1);
    expect(summary.hypotheticalBasis).toBe(100);
    expect(summary.hypotheticalValue).toBe(200);
    expect(summary.changePct).toBeCloseTo(100, 10);
  });

  test("every find unvalued: basis 0, value 0, changePct 0 (no divide-by-zero)", () => {
    const finds = [
      find({ brand: "No price", ticker: "AAA" }),
      find({ brand: "No quote", ticker: "BBB", foundPrice: 10 }),
    ];

    const summary = computeUniverseSummary(finds, new Map());

    expect(summary.findCount).toBe(2);
    expect(summary.valuedFinds).toBe(0);
    expect(summary.hypotheticalBasis).toBe(0);
    expect(summary.hypotheticalValue).toBe(0);
    expect(summary.changePct).toBe(0);
    expect(summary.sources).toEqual([]);
  });

  test("empty universe returns a schema-valid zeroed summary", () => {
    const summary = computeUniverseSummary([], new Map());

    expect(summary.findCount).toBe(0);
    expect(summary.valuedFinds).toBe(0);
    expect(summary.hypotheticalBasis).toBe(0);
    expect(summary.hypotheticalValue).toBe(0);
    expect(summary.changePct).toBe(0);
    expect(summary.sources).toEqual([]);
    expect(UniverseSummary.parse(summary)).toBeTruthy();
  });

  test("sources carry one entry per distinct provider actually used", () => {
    const finds = [
      find({ brand: "A", ticker: "AAA", foundPrice: 10 }),
      find({ brand: "B", ticker: "BBB", foundPrice: 10 }),
      find({ brand: "C", ticker: "CCC", foundPrice: 10 }),
      // Excluded find — its provider must NOT be cited.
      find({ brand: "D", ticker: "DDD" }),
    ];
    const quotes = quoteMap(
      quote({ symbol: "AAA", price: 11, provider: "massive", ts: "2026-08-19T15:00:00.000Z" }),
      quote({ symbol: "BBB", price: 12, provider: "massive", ts: "2026-08-19T15:01:00.000Z" }),
      quote({ symbol: "CCC", price: 13, provider: "yahoo", ts: "2026-08-19T15:02:00.000Z" }),
      quote({ symbol: "DDD", price: 14, provider: "yahoo", ts: "2026-08-19T15:03:00.000Z" }),
    );

    const summary = computeUniverseSummary(finds, quotes);

    expect(summary.valuedFinds).toBe(3);
    // Fixture quotes declare no freshness, so confidence is "low" — never
    // asserted higher than the provider reported.
    expect(summary.sources).toEqual([
      { provider: "massive", fetchedAt: "2026-08-19T15:00:00.000Z", confidence: "low" },
      { provider: "yahoo", fetchedAt: "2026-08-19T15:02:00.000Z", confidence: "low" },
    ]);
    expect(UniverseSummary.parse(summary)).toBeTruthy();
  });

  test("a quote with no declared provider still counts in the math but is never cited", () => {
    const finds = [
      find({ brand: "A", ticker: "AAA", foundPrice: 10 }),
      find({ brand: "B", ticker: "BBB", foundPrice: 10 }),
    ];
    const quotes = quoteMap(
      quote({ symbol: "AAA", price: 11, provider: undefined, ts: "2026-08-19T15:00:00.000Z" }),
      quote({ symbol: "BBB", price: 12, provider: "massive", ts: "2026-08-19T15:05:00.000Z" }),
    );

    const summary = computeUniverseSummary(finds, quotes);

    expect(summary.valuedFinds).toBe(2);
    expect(summary.sources).toEqual([
      { provider: "massive", fetchedAt: "2026-08-19T15:05:00.000Z", confidence: "low" },
    ]);
  });

  test("confidence follows the quote's declared freshness", () => {
    const finds = [
      find({ brand: "A", ticker: "AAA", foundPrice: 10 }),
      find({ brand: "B", ticker: "BBB", foundPrice: 10 }),
    ];
    const quotes = quoteMap(
      quote({ symbol: "AAA", price: 11, provider: "massive", freshness: "real-time" }),
      quote({ symbol: "BBB", price: 12, provider: "yahoo", freshness: "delayed" }),
    );

    const summary = computeUniverseSummary(finds, quotes);

    expect(summary.sources.find((s) => s.provider === "massive")?.confidence).toBe("high");
    expect(summary.sources.find((s) => s.provider === "yahoo")?.confidence).toBe("medium");
  });

  test("generatedAt is an ISO timestamp and the input is never mutated", () => {
    const finds = [find({ brand: "A", ticker: "AAA", foundPrice: 10 })];
    const snapshot = JSON.stringify(finds);

    const summary = computeUniverseSummary(finds, quoteMap(quote({ symbol: "AAA", price: 11 })));

    expect(Number.isNaN(Date.parse(summary.generatedAt))).toBe(false);
    expect(summary.generatedAt).toBe(new Date(summary.generatedAt).toISOString());
    expect(JSON.stringify(finds)).toBe(snapshot);
  });
});
