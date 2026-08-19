import { describe, expect, test } from "bun:test";
import { fallbackResolve, looksLikeTicker } from "./resolveFallback.ts";

describe("looksLikeTicker", () => {
  test("accepts listed symbols", () => {
    expect(looksLikeTicker("mcd")).toBe("MCD");
    expect(looksLikeTicker("BRK.B")).toBe("BRK.B");
  });

  test("rejects place and product names", () => {
    expect(looksLikeTicker("Starbucks")).toBeUndefined();
    expect(looksLikeTicker("Hershey's")).toBeUndefined();
    expect(looksLikeTicker("")).toBeUndefined();
  });
});

describe("fallbackResolve", () => {
  test("typed ticker still gets a chart symbol", () => {
    const r = fallbackResolve("MCD", "MCD");
    expect(r.brand.isPublic).toBe(true);
    expect(r.brand.ticker?.symbol).toBe("MCD");
    expect(r.comparables).toEqual([]);
  });

  test("brand name does not invent a ticker", () => {
    const r = fallbackResolve("Starbucks");
    expect(r.brand.name).toBe("Starbucks");
    expect(r.brand.isPublic).toBe(false);
    expect(r.brand.ticker).toBeUndefined();
  });
});
