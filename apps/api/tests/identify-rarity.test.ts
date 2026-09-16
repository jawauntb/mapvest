import { describe, expect, test } from "bun:test";
import type { Investable } from "@mapvest/core";
import {
  type DexSeed,
  isInSeed,
  rarityForFind,
  rarityForInvestable,
  stampFindList,
  stampIdentifyInvestables,
} from "../src/lib/dex.js";

/**
 * POST /v1/identify stamps rarity via `stampIdentifyInvestables`, the same
 * classifier `/v1/dex` uses (`rarityForFind` + `isInSeed`). This suite is the
 * identify-side unit test: no image, no vision, same seed injection as dex.
 */

const SEED: DexSeed = {
  nike: { ticker: "NKE", sector: "Consumer Discretionary" },
  starbucks: { ticker: "SBUX", sector: "Consumer Discretionary" },
};

function investable(over: Partial<Investable> & { brand: Investable["brand"] }): Investable {
  return {
    comparables: [],
    etfs: [],
    confidence: "high",
    sources: [],
    ...over,
  };
}

describe("POST /v1/identify rarity stamp", () => {
  test("stamps the same tier /v1/dex would classify for each investable", () => {
    const common = investable({
      brand: { name: "Nike", isPublic: true, ticker: { symbol: "NKE" } },
    });
    const rare = investable({
      brand: { name: "In-house label", isPublic: false },
      comparables: [
        {
          ticker: "SBUX",
          name: "Starbucks",
          score: 0.9,
          reasoning: "same category",
          sources: [],
        },
      ],
    });
    const legendary = investable({
      brand: { name: "Unseeded public", isPublic: true, ticker: { symbol: "ZZZZ" } },
    });

    const stamped = stampIdentifyInvestables([common, rare, legendary], SEED);
    expect(stamped.map((inv) => inv.rarity)).toEqual(["common", "rare", "legendary"]);

    for (const inv of stamped) {
      const find = {
        id: "x",
        brand: inv.brand.name,
        ticker: inv.brand.ticker?.symbol,
        isPublic: inv.brand.isPublic,
        comparable: inv.comparables[0]?.ticker,
        confidence: inv.confidence,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      expect(inv.rarity).toBe(rarityForFind(find, isInSeed(find, SEED)));
      expect(inv.rarity).toBe(rarityForInvestable(inv, SEED));
    }
  });

  test("GET /v1/finds stamps the same classifier on journal rows", () => {
    const finds = stampFindList(
      [
        {
          id: "1",
          brand: "Nike",
          ticker: "NKE",
          isPublic: true,
          confidence: "high",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "2",
          brand: "Mystery Co",
          ticker: "ZZZZ",
          isPublic: true,
          confidence: "medium",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      SEED,
    );
    expect(finds.map((f) => f.rarity)).toEqual(["common", "legendary"]);
  });
});
