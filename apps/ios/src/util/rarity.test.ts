import { describe, expect, test } from "bun:test";
import type { Investable } from "@/api/types";
import { colors } from "@/theme/tokens";
import {
  evidenceChipLabel,
  rarityColor,
  rarityFromInvestable,
  rarityLabel,
  resolvedFindRarity,
  resolvedRarity,
  shouldShowRarityChip,
} from "./rarity";

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

describe("resolvedRarity", () => {
  test("prefers a server-stamped legendary over the client fallback", () => {
    expect(resolvedRarity(investable({ rarity: "legendary" }))).toBe("legendary");
  });

  test("older payload without rarity falls back to client classification", () => {
    const rare = investable({
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
    expect(resolvedRarity(rare)).toBe("rare");
    expect(resolvedRarity(investable())).toBeNull();
  });
});

describe("resolvedFindRarity", () => {
  test("uses the server field when present", () => {
    expect(resolvedFindRarity({ rarity: "common" })).toBe("common");
  });

  test("falls back to rare for a private comparable without a server field", () => {
    expect(resolvedFindRarity({ isPublic: false, comparable: "SBUX" })).toBe("rare");
    expect(resolvedFindRarity({ isPublic: true, ticker: "NKE" })).toBeNull();
  });
});

describe("rarityLabel", () => {
  test("four-tier catch labels", () => {
    expect(rarityLabel("common")).toBe("Common catch");
    expect(rarityLabel("uncommon")).toBe("Uncommon catch");
    expect(rarityLabel("rare")).toBe("Rare catch");
    expect(rarityLabel("legendary")).toBe("Legendary catch");
  });
});

describe("rarityColor", () => {
  test("ladder stays on the two-accent palette", () => {
    expect(rarityColor("common")).toBe(colors.fgDim);
    expect(rarityColor("uncommon")).toBe(colors.fgMuted);
    expect(rarityColor("rare")).toBe(colors.accent2);
    expect(rarityColor("legendary")).toBe(colors.warn);
    expect(
      Object.values({ rare: rarityColor("rare"), legendary: rarityColor("legendary") }),
    ).not.toContain("#7C3AED");
  });
});

describe("shouldShowRarityChip", () => {
  test("hides common on the primary card and also-found rows", () => {
    expect(shouldShowRarityChip("common", "primary")).toBe(false);
    expect(shouldShowRarityChip("common", "secondary")).toBe(false);
    expect(shouldShowRarityChip("common", "universe")).toBe(true);
  });

  test("rare and legendary always show", () => {
    expect(shouldShowRarityChip("rare", "primary")).toBe(true);
    expect(shouldShowRarityChip("legendary", "primary")).toBe(true);
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
