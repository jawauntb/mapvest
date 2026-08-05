import { describe, expect, test } from "bun:test";
import { resolveTicker } from "../src/ticker.js";

/**
 * Ten well-known seed brands — resolving these must NOT hit the network,
 * because seedBrands is checked first. The parent-company mappings below
 * are fixed by public filings and shouldn't drift.
 */
const CASES: Array<{ input: string; ticker: string; parent: string }> = [
  { input: "McDonald's", ticker: "MCD", parent: "McDonald's Corp" },
  { input: "Starbucks", ticker: "SBUX", parent: "Starbucks Corp" },
  { input: "Hershey's", ticker: "HSY", parent: "The Hershey Company" },
  { input: "Walmart", ticker: "WMT", parent: "Walmart Inc" },
  { input: "Coca-Cola", ticker: "KO", parent: "The Coca-Cola Co" },
  { input: "Pepsi", ticker: "PEP", parent: "PepsiCo Inc" },
  { input: "Apple", ticker: "AAPL", parent: "Apple Inc" },
  { input: "Microsoft", ticker: "MSFT", parent: "Microsoft Corp" },
  { input: "Nike", ticker: "NKE", parent: "Nike Inc" },
  { input: "Amazon", ticker: "AMZN", parent: "Amazon.com Inc" },
];

describe("resolveTicker (seed hits)", () => {
  for (const c of CASES) {
    test(`resolves ${c.input} -> ${c.ticker}`, async () => {
      const res = await resolveTicker(c.input);
      expect(res.brand.isPublic).toBe(true);
      expect(res.brand.ticker?.symbol).toBe(c.ticker);
      expect(res.brand.parent).toBe(c.parent);
      expect(res.brand.name).toBe(c.input); // preserves caller casing
      // Seed hits are marked as high-confidence manual sources.
      expect(res.sources.length).toBeGreaterThan(0);
      expect(res.sources[0]?.provider).toBe("manual");
      expect(res.sources[0]?.confidence).toBe("high");
    });
  }

  test("normalizes casing/whitespace before matching", async () => {
    const res = await resolveTicker("  MCDONALDS  ");
    expect(res.brand.ticker?.symbol).toBe("MCD");
  });
});
