import { describe, expect, test } from "bun:test";
import { normalizeBrand, normalizeParent } from "../src/normalize.js";
import { resolveTicker } from "../src/ticker.js";

describe("normalizeParent", () => {
  test("strips 'the ' prefix and ' company' suffix", () => {
    expect(normalizeParent("The Hershey Company")).toBe("hershey");
  });

  test("strips ' corp' suffix", () => {
    expect(normalizeParent("McDonald's Corp")).toBe("mcdonald's");
  });

  test("strips ' inc' suffix", () => {
    expect(normalizeParent("PepsiCo Inc")).toBe("pepsico");
  });

  test("strips 'the ' prefix and ' co' suffix", () => {
    expect(normalizeParent("The Coca-Cola Co")).toBe("coca-cola");
  });

  test("preserves 'Brands' since it is not in the suffix list", () => {
    expect(normalizeParent("Yum! Brands")).toBe("yum! brands");
  });

  test("strips ' group' and ' corp' iteratively", () => {
    expect(normalizeParent("Sony Group Corp")).toBe("sony");
  });

  test("strips ' inc' suffix (Alphabet)", () => {
    expect(normalizeParent("Alphabet Inc")).toBe("alphabet");
  });

  test("strips ' ag' suffix", () => {
    expect(normalizeParent("Adidas AG")).toBe("adidas");
  });

  test("strips ' sa' suffix", () => {
    expect(normalizeParent("Nestle SA")).toBe("nestle");
  });

  test("strips ' s.a.' with dots", () => {
    expect(normalizeParent("Acme S.A.")).toBe("acme");
  });

  test("tolerates trailing punctuation around suffix ('Hershey, Inc.')", () => {
    expect(normalizeParent("Hershey, Inc.")).toBe("hershey");
  });

  test("strips repeated corporate suffixes ('Hershey Company Inc')", () => {
    expect(normalizeParent("Hershey Company Inc")).toBe("hershey");
  });

  test("is a no-op on already-normalized short names", () => {
    expect(normalizeParent("hershey")).toBe("hershey");
  });

  test("normalizes curly apostrophes via the shared brand pass", () => {
    // U+2019 RIGHT SINGLE QUOTATION MARK inside "McDonald’s Corp"
    expect(normalizeParent("McDonald’s Corp")).toBe("mcdonald's");
  });
});

describe("normalizeBrand (re-exported from normalize.ts)", () => {
  test("still lowercases and trims", () => {
    expect(normalizeBrand("  Starbucks  ")).toBe("starbucks");
  });
});

describe("resolveTicker parent-name fallback", () => {
  // Each of these inputs is NOT a direct seedBrands key, but IS the parent
  // string (or a close corporate variant) of a seed row. The parent-name
  // fallback must catch them and return the same ticker the brand short-form
  // would have.
  const CASES: Array<{ input: string; ticker: string; parent: string }> = [
    { input: "The Hershey Company", ticker: "HSY", parent: "The Hershey Company" },
    { input: "Hershey Co", ticker: "HSY", parent: "The Hershey Company" },
    { input: "Hershey Company Inc", ticker: "HSY", parent: "The Hershey Company" },
    { input: "Hershey, Inc.", ticker: "HSY", parent: "The Hershey Company" },
    { input: "McDonald's Corp", ticker: "MCD", parent: "McDonald's Corp" },
    { input: "PepsiCo Inc", ticker: "PEP", parent: "PepsiCo Inc" },
    { input: "The Coca-Cola Co", ticker: "KO", parent: "The Coca-Cola Co" },
    { input: "Yum! Brands", ticker: "YUM", parent: "Yum! Brands" },
    { input: "Sony Group Corp", ticker: "SONY", parent: "Sony Group Corp" },
    { input: "Alphabet Inc", ticker: "GOOGL", parent: "Alphabet Inc" },
  ];

  for (const c of CASES) {
    test(`resolves '${c.input}' -> ${c.ticker} via parent fallback`, async () => {
      const res = await resolveTicker(c.input);
      expect(res.brand.isPublic).toBe(true);
      expect(res.brand.ticker?.symbol).toBe(c.ticker);
      expect(res.brand.parent).toBe(c.parent);
      expect(res.brand.name).toBe(c.input); // preserves caller casing
      // Fallback still counts as a seed-manual source, high confidence.
      expect(res.sources[0]?.provider).toBe("manual");
      expect(res.sources[0]?.confidence).toBe("high");
    });
  }

  test("unknown parent falls through to the exa search path", async () => {
    // A made-up name that must not match any seed row after either
    // normalizeBrand OR normalizeParent. It should skip both the direct
    // lookup and the parent-name fallback, ending up on the exa branch
    // (which returns a private Brand with no ticker).
    const res = await resolveTicker("Zorpblat Umbrella Holdings Inc");
    expect(res.brand.isPublic).toBe(false);
    expect(res.brand.ticker).toBeUndefined();
    expect(res.brand.name).toBe("Zorpblat Umbrella Holdings Inc");
  });
});
