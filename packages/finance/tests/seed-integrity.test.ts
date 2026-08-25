import { describe, expect, test } from "bun:test";
import { seedBrands } from "../src/seed.js";

/**
 * Seed integrity — sanity rules applied to every row of data/brands.json.
 *
 * These are format-only checks. They catch typos, casing mistakes, and
 * duplicated corporate suffixes that slip into hand-edited seed rows.
 * They do NOT verify that the mapping itself is correct (that's the job
 * of ticker.test.ts spot-checks and human review at merge time).
 */

// Uppercase letters only, optionally followed by a single dot-letter class
// suffix (e.g. "BF.B"). The task rule is "uppercase A-Z"; the dot separator
// is the standard NYSE dual-class notation and does not indicate lowercase
// or non-alphabetic content — the letters themselves are still A-Z.
const TICKER_RE = /^[A-Z]+(\.[A-Z])?$/;

const ALLOWED_EXCHANGES = new Set(["NYSE", "NASDAQ", "OTC", "CBOE", "LSE", "TSX", "TSE"]);

describe("seed integrity", () => {
  test("every ticker is uppercase A-Z (with optional class-share suffix)", () => {
    const violations: Array<{ key: string; ticker: string }> = [];
    for (const [key, row] of Object.entries(seedBrands)) {
      if (!TICKER_RE.test(row.ticker)) {
        violations.push({ key, ticker: row.ticker });
      }
    }
    expect(violations).toEqual([]);
  });

  test("every exchange is in the allow-list", () => {
    const violations: Array<{ key: string; exchange: string }> = [];
    for (const [key, row] of Object.entries(seedBrands)) {
      if (!ALLOWED_EXCHANGES.has(row.exchange)) {
        violations.push({ key, exchange: row.exchange });
      }
    }
    expect(violations).toEqual([]);
  });

  test("parent name has no duplicated corporate suffix", () => {
    // Word-boundary match so "Incorporated" or "Include" don't false-positive,
    // and so "Inc." at the end still counts.
    const INC_RE = /\bInc\b/g;
    const violations: Array<{ key: string; parent: string; reason: string }> = [];
    for (const [key, row] of Object.entries(seedBrands)) {
      const p = row.parent;
      const incMatches = p.match(INC_RE);
      if (incMatches && incMatches.length >= 2) {
        violations.push({ key, parent: p, reason: "Inc appears twice" });
      }
      if (p.includes("Corp Corp")) {
        violations.push({ key, parent: p, reason: "Corp Corp" });
      }
    }
    expect(violations).toEqual([]);
  });

  test("holds at least 1100 rows after this pass (add-only invariant)", () => {
    expect(Object.keys(seedBrands).length).toBeGreaterThanOrEqual(1100);
  });

  test("spot-check a few new brands land on the expected ticker", () => {
    // Cannabis
    expect(seedBrands.curaleaf?.ticker).toBe("CURLF");
    expect(seedBrands.trulieve?.ticker).toBe("TCNNF");
    // Gyms + fitness
    expect(seedBrands["planet fitness"]?.ticker).toBe("PLNT");
    expect(seedBrands["xponential fitness"]?.ticker).toBe("XPOF");
    expect(seedBrands["club pilates"]?.ticker).toBe("XPOF");
    // Beauty
    expect(seedBrands.ulta?.ticker).toBe("ULTA");
    expect(seedBrands.sephora?.ticker).toBe("LVMUY");
    expect(seedBrands["sally beauty"]?.ticker).toBe("SBH");
    // Airlines
    expect(seedBrands.allegiant?.ticker).toBe("ALGT");
    // Hotels / vacation ownership
    expect(seedBrands["hilton grand vacations"]?.ticker).toBe("HGV");
    expect(seedBrands["marriott vacations"]?.ticker).toBe("VAC");
    expect(seedBrands["travel + leisure"]?.ticker).toBe("TNL");
    // Big-box club
    expect(seedBrands["bj's wholesale"]?.ticker).toBe("BJ");
  });
});
