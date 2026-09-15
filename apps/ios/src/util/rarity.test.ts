import { describe, expect, test } from "bun:test";
import type { Investable } from "@/api/types";
import { evidenceChipLabel, rarityFromInvestable, rarityLabel } from "./rarity";

function investable(overrides: Partial<Investable> = {}): Investable {
  return {
    brand: { name: "Acme", isPublic: true, ticker: { symbol: "ACME" } },
    comparables: [],
    etfs: [],
    confidence: "high",
    sources: [],
    ...overrides,
  } as Investable;
}

describe("rarityFromInvestable", () => {
  test("private brand bridged via a comparable is rare", () => {
    const inv = investable({
      brand: { name: "In-house label", isPublic: false } as Investable["brand"],
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
    expect(rarityFromInvestable(inv)).toBe("rare");
  });

  test("private brand without a comparable is not flagged rare", () => {
    const inv = investable({
      brand: { name: "In-house label", isPublic: false } as Investable["brand"],
      comparables: [],
    });
    expect(rarityFromInvestable(inv)).toBeNull();
  });

  test("public brand returns null — client cannot distinguish common vs legendary", () => {
    expect(rarityFromInvestable(investable())).toBeNull();
  });

  test("undefined investable returns null", () => {
    expect(rarityFromInvestable(undefined)).toBeNull();
  });
});

describe("rarityLabel", () => {
  test("rare → 'Rare catch'", () => {
    expect(rarityLabel("rare")).toBe("Rare catch");
  });
});

describe("evidenceChipLabel", () => {
  test("positive count shows the count", () => {
    expect(evidenceChipLabel(3)).toBe("Evidence · 3");
    expect(evidenceChipLabel(1)).toBe("Evidence · 1");
  });

  test("zero or negative shows the no-citations warning", () => {
    expect(evidenceChipLabel(0)).toBe("No citations");
    expect(evidenceChipLabel(-1)).toBe("No citations");
  });
});
