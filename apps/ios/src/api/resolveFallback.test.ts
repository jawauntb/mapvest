import { describe, expect, test } from "bun:test";
import { coerceResolve, fallbackResolve, looksLikeTicker, routeParam } from "./resolveFallback.ts";

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

describe("routeParam", () => {
  test("decodes a ticker path", () => {
    expect(routeParam("RLX")).toBe("RLX");
    expect(routeParam("RLX%20")).toBe("RLX ");
  });

  test("takes the first array entry", () => {
    expect(routeParam(["RLX", "extra"])).toBe("RLX");
  });

  test("does not throw on a malformed percent sequence", () => {
    expect(routeParam("%E0%A4%A")).toBe("%E0%A4%A");
  });
});

describe("coerceResolve", () => {
  test("production RLX payload keeps the listed ticker", () => {
    const r = coerceResolve(
      {
        brand: { name: "RLX Technology Inc.", isPublic: true, ticker: { symbol: "RLX" } },
        comparables: [],
        etfs: [],
      },
      "RLX",
      "RLX",
    );
    expect(r.brand.ticker?.symbol).toBe("RLX");
    expect(r.comparables).toEqual([]);
    expect(r.etfs).toEqual([]);
  });

  test("missing arrays do not throw in render helpers", () => {
    const r = coerceResolve({ brand: { name: "X", isPublic: false } } as never, "X");
    expect(() => r.comparables.flatMap((c) => c.sources)).not.toThrow();
    expect(() => r.etfs.map((e) => e.source)).not.toThrow();
    expect(r.comparables).toEqual([]);
    expect(r.etfs).toEqual([]);
  });

  test("falls back when the body is missing", () => {
    const r = coerceResolve(undefined, "MCD", "MCD");
    expect(r.brand.ticker?.symbol).toBe("MCD");
    expect(r.comparables).toEqual([]);
  });
});
