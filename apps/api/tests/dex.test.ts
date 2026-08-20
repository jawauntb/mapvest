import { describe, expect, test } from "bun:test";
import { DexResponse } from "@mapvest/core";
import { canonicalSector, seedBrands } from "@mapvest/finance";
import {
  type DexSeed,
  UNKNOWN_SECTOR,
  computeDex,
  effectiveTicker,
  isInSeed,
  rarityForFind,
  sectorTotals,
  seedTickerSectors,
  tilesVisited,
} from "../src/lib/dex.js";
import { encodeGeohash } from "../src/lib/geohash.js";

/**
 * Pure-function tests — no network, no POSTGRES_URL, no store. Every case
 * injects its own seed literal so the assertions stay stable as brands.json
 * grows (add-only). One case reads the real seed, but only for invariants
 * that hold regardless of its contents.
 */

let seq = 0;
function find(over: Partial<import("@mapvest/core").Find> = {}) {
  seq += 1;
  return {
    id: `f_${seq}`,
    brand: `Brand ${seq}`,
    confidence: "high" as const,
    createdAt: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
    ...over,
  };
}

/**
 * Deliberately alias-heavy, mirroring brands.json: two keys for MCD and two
 * for KO, so entry-count and distinct-ticker-count differ.
 */
const SEED: DexSeed = {
  "mcdonald's": { ticker: "MCD", sector: "Consumer Discretionary" },
  mcdonalds: { ticker: "MCD", sector: "Consumer Discretionary" },
  nike: { ticker: "NKE", sector: "Consumer Discretionary" },
  starbucks: { ticker: "SBUX", sector: "Consumer Discretionary" },
  "coca-cola": { ticker: "KO", sector: "Consumer Staples" },
  coke: { ticker: "KO", sector: "Consumer Staples" },
  pepsi: { ticker: "PEP", sector: "Consumer Staples" },
  apple: { ticker: "AAPL", sector: "Information Technology" },
};

describe("sectorTotals", () => {
  test("counts DISTINCT seed tickers per canonical sector, collapsing aliases", () => {
    const totals = sectorTotals(SEED);
    // 4 Consumer Discretionary entries but only 3 tickers (MCD twice).
    expect(totals.get("Consumer Discretionary")).toBe(3);
    // 3 Consumer Staples entries but only 2 tickers (KO twice).
    expect(totals.get("Consumer Staples")).toBe(2);
    expect(totals.get("Information Technology")).toBe(1);
    expect(totals.size).toBe(3);
  });

  test("canonicalizes sector aliases and buckets unknown/missing sectors", () => {
    const totals = sectorTotals({
      a: { ticker: "XOM", sector: "oil & gas" }, // alias -> Energy
      b: { ticker: "CVX", sector: "energy" }, // case-insensitive -> Energy
      c: { ticker: "ZZZZ", sector: "Fictional Sector" },
      d: { ticker: "YYYY" }, // no sector at all
    });
    expect(totals.get("Energy")).toBe(2);
    expect(totals.get(UNKNOWN_SECTOR)).toBe(2);
  });

  test("seedTickerSectors maps every ticker exactly once", () => {
    const map = seedTickerSectors(SEED);
    expect(map.size).toBe(6);
    expect(map.get("MCD")).toBe("Consumer Discretionary");
    expect(map.get("KO")).toBe("Consumer Staples");
  });
});

describe("effectiveTicker", () => {
  test("prefers the find's own ticker, falls back to the comparable", () => {
    expect(effectiveTicker(find({ ticker: "NKE", isPublic: true }))).toBe("NKE");
    expect(effectiveTicker(find({ isPublic: false, comparable: "SBUX" }))).toBe("SBUX");
  });

  test("normalizes case and whitespace, and returns null when neither is usable", () => {
    expect(effectiveTicker(find({ ticker: " nke " }))).toBe("NKE");
    expect(effectiveTicker(find({ ticker: "", comparable: "ko" }))).toBe("KO");
    expect(effectiveTicker(find({}))).toBeNull();
  });
});

describe("computeDex — sector bucketing", () => {
  test("duplicate tickers count once (distinct-count), across brand aliases", () => {
    const dex = computeDex(
      [
        find({ brand: "McDonald's", ticker: "MCD", isPublic: true }),
        find({ brand: "McDonalds", ticker: "MCD", isPublic: true }), // same ticker
        find({ brand: "McDonald's", ticker: "mcd", isPublic: true }), // case variant
        find({ brand: "Nike", ticker: "NKE", isPublic: true }),
      ],
      SEED,
    );
    const cd = dex.sectors.find((s) => s.sector === "Consumer Discretionary");
    expect(cd).toEqual({ sector: "Consumer Discretionary", found: 2, total: 3 });
    expect(dex.totalFinds).toBe(4);
  });

  test("private finds match on their comparable ticker", () => {
    const dex = computeDex(
      [
        find({ brand: "Blue Bottle", isPublic: false, comparable: "SBUX" }),
        find({ brand: "Local Bodega Cola", isPublic: false, comparable: "KO" }),
      ],
      SEED,
    );
    expect(dex.sectors.find((s) => s.sector === "Consumer Discretionary")?.found).toBe(1);
    expect(dex.sectors.find((s) => s.sector === "Consumer Staples")?.found).toBe(1);
  });

  test("a public find and a private comparable pointing at the same ticker count once", () => {
    const dex = computeDex(
      [
        find({ brand: "Starbucks", ticker: "SBUX", isPublic: true }),
        find({ brand: "Blue Bottle", isPublic: false, comparable: "SBUX" }),
      ],
      SEED,
    );
    expect(dex.sectors.find((s) => s.sector === "Consumer Discretionary")?.found).toBe(1);
    expect(dex.totalFinds).toBe(2);
  });

  test("lists every seed sector, including ones with zero catches", () => {
    const dex = computeDex([find({ ticker: "AAPL", isPublic: true })], SEED);
    expect(dex.sectors.map((s) => s.sector)).toEqual([
      "Consumer Discretionary",
      "Consumer Staples",
      "Information Technology",
    ]);
    expect(dex.sectors.find((s) => s.sector === "Consumer Staples")).toEqual({
      sector: "Consumer Staples",
      found: 0,
      total: 2,
    });
  });

  test("finds outside the seed raise totalFinds but no sector row", () => {
    const dex = computeDex(
      [
        find({ brand: "Nike", ticker: "NKE", isPublic: true }),
        find({ brand: "Some New Chain", ticker: "ZZZZ", isPublic: true }),
        find({ brand: "Unresolved", isPublic: false }), // no ticker at all
      ],
      SEED,
    );
    expect(dex.totalFinds).toBe(3);
    expect(dex.sectors.reduce((n, s) => n + s.found, 0)).toBe(1);
    expect(dex.sectors.some((s) => s.sector === UNKNOWN_SECTOR)).toBe(false);
  });

  test("found never exceeds total for any sector", () => {
    const dex = computeDex(
      Object.values(SEED).map((e) => find({ ticker: e.ticker, isPublic: true })),
      SEED,
    );
    for (const s of dex.sectors) {
      expect(s.found).toBeLessThanOrEqual(s.total);
    }
    // Catching every seed entry completes every sector — completion is reachable.
    expect(dex.sectors.every((s) => s.found === s.total)).toBe(true);
  });
});

describe("computeDex — tiles", () => {
  test("counts distinct geohash-6 cells and ignores finds without coords", () => {
    const dex = computeDex(
      [
        find({ ticker: "NKE", lat: 37.7749, lng: -122.4194 }),
        // Same block in SF -> same precision-6 tile.
        find({ ticker: "MCD", lat: 37.7749, lng: -122.4194 }),
        find({ ticker: "KO", lat: 40.7128, lng: -74.006 }), // NYC -> different tile
        find({ ticker: "PEP" }), // no coords
        find({ ticker: "AAPL", lat: 37.7749 }), // lat only
        find({ ticker: "SBUX", lng: -122.4194 }), // lng only
      ],
      SEED,
    );
    expect(dex.tilesVisited).toBe(2);
    expect(dex.totalFinds).toBe(6);
  });

  test("tilesVisited returns the actual geohash-6 keys", () => {
    const tiles = tilesVisited([find({ lat: 37.7749, lng: -122.4194 })]);
    expect([...tiles]).toEqual([encodeGeohash(37.7749, -122.4194, 6)]);
    expect([...tiles][0]!.length).toBe(6);
  });

  test("nearby-but-distinct coordinates land in different tiles", () => {
    const dex = computeDex(
      [find({ lat: 37.7749, lng: -122.4194 }), find({ lat: 34.0522, lng: -118.2437 })],
      SEED,
    );
    expect(dex.tilesVisited).toBe(2);
  });
});

describe("rarityForFind", () => {
  test("not in the seed is legendary, regardless of public/private", () => {
    expect(rarityForFind(find({ ticker: "ZZZZ", isPublic: true }), false)).toBe("legendary");
    expect(rarityForFind(find({ isPublic: false, comparable: "ZZZZ" }), false)).toBe("legendary");
  });

  test("in the seed and explicitly private is rare", () => {
    expect(rarityForFind(find({ isPublic: false, comparable: "SBUX" }), true)).toBe("rare");
  });

  test("in the seed and public (or unknown) is common", () => {
    expect(rarityForFind(find({ ticker: "NKE", isPublic: true }), true)).toBe("common");
    expect(rarityForFind(find({ ticker: "NKE" }), true)).toBe("common");
  });

  test("never returns uncommon — reserved for the later market-cap pass", () => {
    const cases = [
      rarityForFind(find({ ticker: "NKE", isPublic: true }), true),
      rarityForFind(find({ isPublic: false, comparable: "SBUX" }), true),
      rarityForFind(find({ ticker: "ZZZZ", isPublic: true }), false),
    ];
    expect(cases).not.toContain("uncommon");
  });

  test("isInSeed drives the branch off the effective ticker", () => {
    expect(isInSeed(find({ ticker: "NKE" }), SEED)).toBe(true);
    expect(isInSeed(find({ ticker: "nke" }), SEED)).toBe(true);
    expect(isInSeed(find({ isPublic: false, comparable: "KO" }), SEED)).toBe(true);
    expect(isInSeed(find({ ticker: "ZZZZ" }), SEED)).toBe(false);
    expect(isInSeed(find({ brand: "Unresolved" }), SEED)).toBe(false);
  });
});

describe("computeDex — empty and schema", () => {
  test("empty finds yields zeroed sectors and a schema-valid response", () => {
    const dex = computeDex([], SEED);
    expect(dex.totalFinds).toBe(0);
    expect(dex.tilesVisited).toBe(0);
    expect(dex.sectors.length).toBe(3);
    expect(dex.sectors.every((s) => s.found === 0)).toBe(true);
    expect(dex.sectors.every((s) => s.total > 0)).toBe(true);
    expect(DexResponse.parse(dex)).toEqual(dex);
  });

  test("an empty seed yields no sector rows but still counts finds and tiles", () => {
    const dex = computeDex([find({ ticker: "NKE", lat: 37.7749, lng: -122.4194 })], {});
    expect(dex).toEqual({ sectors: [], tilesVisited: 1, totalFinds: 1 });
    expect(DexResponse.parse(dex)).toEqual(dex);
  });
});

describe("computeDex against the real brands.json seed", () => {
  test("is schema-valid and every sector is canonical with a positive total", () => {
    const dex = computeDex(
      [
        find({ brand: "McDonald's", ticker: "MCD", isPublic: true, lat: 37.7749, lng: -122.4194 }),
        find({ brand: "McDonalds", ticker: "MCD", isPublic: true, lat: 37.7749, lng: -122.4194 }),
      ],
      seedBrands,
    );
    expect(DexResponse.parse(dex)).toEqual(dex);
    expect(dex.totalFinds).toBe(2);
    expect(dex.tilesVisited).toBe(1);
    expect(dex.sectors.length).toBeGreaterThan(0);
    for (const s of dex.sectors) {
      expect(s.total).toBeGreaterThan(0);
      expect(s.found).toBeLessThanOrEqual(s.total);
      if (s.sector !== UNKNOWN_SECTOR) {
        expect(canonicalSector(s.sector)).toBe(s.sector);
      }
    }
    // The two aliased McDonald's catches are one distinct ticker.
    expect(dex.sectors.reduce((n, s) => n + s.found, 0)).toBe(1);
  });

  test("sector totals sum to the number of distinct tickers in the seed", () => {
    const totals = sectorTotals(seedBrands);
    const distinctTickers = new Set(
      Object.values(seedBrands).map((e) => e.ticker.trim().toUpperCase()),
    );
    const summed = [...totals.values()].reduce((a, b) => a + b, 0);
    expect(summed).toBe(distinctTickers.size);
  });
});
