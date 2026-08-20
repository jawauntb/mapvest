import { describe, expect, test } from "bun:test";
import { Find } from "@mapvest/core";
import { listFinds, recordFind, uniqueFindsNewestFirst } from "../src/lib/finds-store.js";

/**
 * In-memory path only (POSTGRES_URL unset in test env). Covers the record →
 * list contract the finds journal depends on: newest-first ordering, the
 * limit parameter, the 500-per-user memory cap, and core-schema shape.
 */
describe("finds-store (in-memory)", () => {
  const userId = () => `u_finds_${Math.random().toString(36).slice(2)}`;

  test("recordFind then listFinds returns newest-first, schema-valid entries", async () => {
    const uid = userId();
    await recordFind(uid, {
      brand: "Church & Dwight",
      ticker: "CHD",
      isPublic: true,
      confidence: "high",
      foundPrice: 101.25,
    });
    await recordFind(uid, {
      brand: "Blue Bottle",
      isPublic: false,
      comparable: "SBUX",
      confidence: "medium",
      lat: 37.77,
      lng: -122.42,
    });
    await recordFind(uid, {
      brand: "Nintendo",
      ticker: "NTDOY",
      isPublic: true,
      confidence: "high",
    });

    const finds = await listFinds(uid);
    expect(finds.map((f) => f.brand)).toEqual(["Nintendo", "Blue Bottle", "Church & Dwight"]);
    for (const f of finds) {
      const parsed = Find.parse(f);
      expect(parsed.id).toBe(f.id);
    }
    const privateFind = finds[1]!;
    expect(privateFind.ticker).toBeUndefined();
    expect(privateFind.comparable).toBe("SBUX");
    expect(privateFind.lat).toBe(37.77);
  });

  test("listFinds respects the limit and keeps newest-first order", async () => {
    const uid = userId();
    await recordFind(uid, { brand: "First", isPublic: false, confidence: "low" });
    await recordFind(uid, { brand: "Second", isPublic: false, confidence: "low" });
    await recordFind(uid, { brand: "Third", isPublic: false, confidence: "low" });

    const page = await listFinds(uid, 2);
    expect(page.map((f) => f.brand)).toEqual(["Third", "Second"]);
  });

  test("memory fallback keeps at most 500 finds per user, dropping the oldest", async () => {
    const uid = userId();
    for (let i = 0; i < 505; i++) {
      await recordFind(uid, { brand: `Brand ${i}`, isPublic: false, confidence: "low" });
    }
    const finds = await listFinds(uid, 1000);
    expect(finds.length).toBe(500);
    expect(finds[0]?.brand).toBe("Brand 504");
    expect(finds.at(-1)?.brand).toBe("Brand 5");
    Find.parse(finds[0]);
  });

  test("recordFind keeps one row per ticker; recatch returns the original", async () => {
    const uid = userId();
    const first = await recordFind(uid, {
      brand: "Apple",
      ticker: "AAPL",
      isPublic: true,
      confidence: "high",
      foundPrice: 180,
    });
    const second = await recordFind(uid, {
      brand: "Apple",
      ticker: "aapl",
      isPublic: true,
      confidence: "medium",
      foundPrice: 181,
    });
    expect(second.id).toBe(first.id);
    const finds = await listFinds(uid);
    expect(finds.map((f) => f.ticker)).toEqual(["AAPL"]);
    expect(finds[0]?.foundPrice).toBe(180);
  });

  test("uniqueFindsNewestFirst keeps the newest row per ticker", () => {
    const collapsed = uniqueFindsNewestFirst([
      {
        id: "newer-aapl",
        brand: "Apple",
        ticker: "AAPL",
        isPublic: true,
        confidence: "low",
        createdAt: "2026-08-19T20:00:00.000Z",
      },
      {
        id: "older-aapl",
        brand: "Apple Store",
        ticker: "AAPL",
        isPublic: true,
        confidence: "high",
        createdAt: "2026-08-18T20:00:00.000Z",
      },
      {
        id: "sbux",
        brand: "Starbucks",
        ticker: "SBUX",
        isPublic: true,
        confidence: "high",
        createdAt: "2026-08-19T19:00:00.000Z",
      },
    ]);
    expect(collapsed.map((f) => f.id)).toEqual(["newer-aapl", "sbux"]);
  });
});
