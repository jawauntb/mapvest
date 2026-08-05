import { describe, expect, test } from "bun:test";
import { normalizeBrand, seedBrands } from "../src/seed.js";

describe("normalizeBrand", () => {
  test("lowercases and trims", () => {
    expect(normalizeBrand("  Starbucks  ")).toBe("starbucks");
  });

  test("collapses internal whitespace", () => {
    expect(normalizeBrand("Home    Depot")).toBe("home depot");
    expect(normalizeBrand("Home\tDepot")).toBe("home depot");
  });

  test("normalizes curly apostrophes to straight", () => {
    // U+2019 RIGHT SINGLE QUOTATION MARK
    expect(normalizeBrand("McDonald’s")).toBe("mcdonald's");
    // U+2018 LEFT SINGLE QUOTATION MARK
    expect(normalizeBrand("O‘Reilly Auto Parts")).toBe("o'reilly auto parts");
    // U+02BC MODIFIER LETTER APOSTROPHE
    expect(normalizeBrand("Wendyʼs")).toBe("wendy's");
  });

  test("is idempotent", () => {
    const a = normalizeBrand("Coca-Cola  ");
    expect(normalizeBrand(a)).toBe(a);
  });

  test("keys the seed table so common inputs hit the same row", () => {
    // seedBrands must be keyed with the same shape normalizeBrand emits.
    expect(seedBrands[normalizeBrand("McDonald's")]).toBeDefined();
    expect(seedBrands[normalizeBrand("STARBUCKS")]).toBeDefined();
    expect(seedBrands[normalizeBrand("  Home Depot ")]).toBeDefined();
  });
});

describe("seedBrands scale", () => {
  test("holds at least 500 hand-vetted rows", () => {
    expect(Object.keys(seedBrands).length).toBeGreaterThanOrEqual(500);
  });

  test("every row has a ticker + exchange + parent and is public", () => {
    for (const [key, row] of Object.entries(seedBrands)) {
      expect(typeof row.ticker).toBe("string");
      expect(row.ticker.length).toBeGreaterThan(0);
      expect(typeof row.exchange).toBe("string");
      expect(row.exchange.length).toBeGreaterThan(0);
      expect(typeof row.parent).toBe("string");
      expect(row.parent.length).toBeGreaterThan(0);
      expect(row.isPublic).toBe(true);
      // key must already be normalized (add-only invariant)
      expect(key).toBe(normalizeBrand(key));
    }
  });
});
