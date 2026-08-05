import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolveEtfExposure } from "../src/etf.js";

/**
 * These tests exercise the fallback path of resolveEtfExposure: the search
 * layer is forced to throw by unsetting EXA_API_KEY, and the resolver should
 * fall through to the hand-curated sector -> ETF map.
 *
 * Note: this file transitively imports @mapvest/search via etf.ts, so it
 * requires `bun install` to have wired workspace deps.
 */
describe("resolveEtfExposure fallback path", () => {
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env.EXA_API_KEY;
    delete process.env.EXA_API_KEY;
  });
  afterAll(() => {
    if (saved !== undefined) process.env.EXA_API_KEY = saved;
  });

  test("falls back to sector map for a known seed brand", async () => {
    // Hershey's is a Consumer Staples seed row.
    const res = await resolveEtfExposure("Hershey's");
    expect(res.length).toBe(3);
    expect(res.map((r) => r.ticker)).toEqual(["XLP", "VDC", "IYK"]);
    for (const r of res) {
      expect(r.weight).toBe(0);
      expect(r.source.provider).toBe("manual");
      expect(r.source.confidence).toBe("medium");
    }
  });

  test("falls back for a raw sector name", async () => {
    const res = await resolveEtfExposure("Information Technology");
    expect(res.map((r) => r.ticker)).toEqual(["XLK", "VGT", "IYW"]);
  });

  test("returns empty when nothing resolves", async () => {
    const res = await resolveEtfExposure("not-a-real-brand-xyz-123");
    expect(res).toEqual([]);
  });
});
