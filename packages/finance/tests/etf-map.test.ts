import { describe, expect, test } from "bun:test";
import {
  canonicalSector,
  fallbackEtfsForSector,
  sectorEtfMap,
} from "../src/etf-map.js";

describe("etf-map", () => {
  test("has an entry per GICS sector with exactly 3 ETFs", () => {
    const sectors = [
      "Communication Services",
      "Consumer Discretionary",
      "Consumer Staples",
      "Energy",
      "Financials",
      "Health Care",
      "Industrials",
      "Information Technology",
      "Materials",
      "Real Estate",
      "Utilities",
    ];
    for (const s of sectors) {
      const row = sectorEtfMap[s];
      expect(row).toBeDefined();
      expect(row!.length).toBe(3);
      for (const etf of row!) {
        expect(typeof etf.ticker).toBe("string");
        expect(etf.ticker).toMatch(/^[A-Z]{2,5}$/);
        expect(typeof etf.name).toBe("string");
        expect(etf.name.length).toBeGreaterThan(0);
      }
    }
  });

  test("canonicalSector normalizes aliases", () => {
    expect(canonicalSector("tech")).toBe("Information Technology");
    expect(canonicalSector("healthcare")).toBe("Health Care");
    expect(canonicalSector("REITs")).toBe("Real Estate");
    expect(canonicalSector("consumer defensive")).toBe("Consumer Staples");
    expect(canonicalSector("Consumer Staples")).toBe("Consumer Staples");
    expect(canonicalSector("nonsense")).toBeNull();
    expect(canonicalSector(undefined)).toBeNull();
    expect(canonicalSector("")).toBeNull();
  });

  test("fallbackEtfsForSector returns the map entry or empty", () => {
    const staples = fallbackEtfsForSector("Consumer Staples");
    expect(staples.map((e) => e.ticker)).toEqual(["XLP", "VDC", "IYK"]);
    const tech = fallbackEtfsForSector("tech");
    expect(tech.map((e) => e.ticker)).toEqual(["XLK", "VGT", "IYW"]);
    expect(fallbackEtfsForSector("banana")).toEqual([]);
    expect(fallbackEtfsForSector(undefined)).toEqual([]);
  });

  test("known Consumer Staples anchors: XLP is present and first", () => {
    // XLP is the SPDR sector fund; we want it first for predictability.
    const first = sectorEtfMap["Consumer Staples"]?.[0];
    expect(first?.ticker).toBe("XLP");
  });
});
