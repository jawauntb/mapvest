import { describe, expect, test } from "bun:test";
import type { Find as FindType } from "@mapvest/core";
import { Find, TerritoryResponse } from "@mapvest/core";
import { findsInTile, recordFind } from "../src/lib/finds-store.js";
import { encodeGeohash } from "../src/lib/geohash.js";
import { awardXp } from "../src/lib/progress-store.js";
import {
  PIONEER_XP,
  TILE_PRECISION,
  completion,
  isPioneer,
  tileBounds,
  tileCenter,
  tileFor,
  tileOfFind,
} from "../src/lib/territory.js";

/**
 * Pure-function tests — no network, no POSTGRES_URL, no store. Every fact
 * here must hold from plain object literals alone.
 */

const SF = { lat: 37.7749, lng: -122.4194 };
const NYC = { lat: 40.7484, lng: -73.9857 };

function find(partial: Partial<FindType> & { brand: string }): FindType {
  return {
    id: `f_${partial.brand}`,
    confidence: "high",
    createdAt: "2026-08-15T12:00:00.000Z",
    ...partial,
  } as FindType;
}

describe("tileFor", () => {
  test("is the precision-6 geohash of the coordinate", () => {
    expect(tileFor(SF.lat, SF.lng)).toBe(encodeGeohash(SF.lat, SF.lng, TILE_PRECISION));
    expect(tileFor(SF.lat, SF.lng)).toHaveLength(6);
  });

  test("is stable inside a cell and different across distant cells", () => {
    // ~10m apart — same block, same tile.
    expect(tileFor(SF.lat + 0.00005, SF.lng)).toBe(tileFor(SF.lat, SF.lng));
    expect(tileFor(NYC.lat, NYC.lng)).not.toBe(tileFor(SF.lat, SF.lng));
  });

  test("tileOfFind ignores finds without usable coordinates", () => {
    expect(tileOfFind(find({ brand: "Chipotle", lat: SF.lat, lng: SF.lng }))).toBe(
      tileFor(SF.lat, SF.lng),
    );
    expect(tileOfFind(find({ brand: "Nintendo" }))).toBeNull();
    expect(tileOfFind(find({ brand: "Broken", lat: Number.NaN, lng: SF.lng }))).toBeNull();
    expect(tileOfFind(find({ brand: "HalfCoord", lat: SF.lat }))).toBeNull();
  });
});

describe("tileBounds / tileCenter", () => {
  test("decode is the inverse of encode: a tile's centre re-encodes to itself", () => {
    for (const point of [SF, NYC, { lat: 0, lng: 0 }, { lat: -33.87, lng: 151.21 }]) {
      const tile = tileFor(point.lat, point.lng);
      const center = tileCenter(tile);
      expect(center).not.toBeNull();
      expect(tileFor(center!.lat, center!.lng)).toBe(tile);
    }
  });

  test("the coordinate that produced a tile lies inside that tile's bounds", () => {
    const bounds = tileBounds(tileFor(SF.lat, SF.lng));
    expect(bounds).not.toBeNull();
    expect(SF.lat).toBeGreaterThanOrEqual(bounds!.latMin);
    expect(SF.lat).toBeLessThanOrEqual(bounds!.latMax);
    expect(SF.lng).toBeGreaterThanOrEqual(bounds!.lngMin);
    expect(SF.lng).toBeLessThanOrEqual(bounds!.lngMax);
    // A precision-6 cell is roughly 1.2km x 0.6km — sanity-check the scale.
    expect(bounds!.latMax - bounds!.latMin).toBeLessThan(0.01);
    expect(bounds!.lngMax - bounds!.lngMin).toBeLessThan(0.02);
  });

  test("a non-geohash string decodes to null rather than a plausible point", () => {
    // 'a', 'i', 'l', 'o' are excluded from the geohash alphabet.
    expect(tileBounds("aiolos")).toBeNull();
    expect(tileCenter("")).toBeNull();
    expect(tileCenter("   ")).toBeNull();
  });
});

describe("isPioneer", () => {
  const tile = tileFor(SF.lat, SF.lng);

  test("true when no prior find sits in the tile", () => {
    expect(isPioneer(tile, [])).toBe(true);
    expect(isPioneer(tile, [find({ brand: "Shake Shack", ...NYC })])).toBe(true);
  });

  test("false once any prior find sits in the tile", () => {
    expect(isPioneer(tile, [find({ brand: "Chipotle", ...SF })])).toBe(false);
    // Same cell, a few metres away.
    expect(
      isPioneer(tile, [find({ brand: "Blue Bottle", lat: SF.lat + 0.00005, lng: SF.lng })]),
    ).toBe(false);
  });

  test("finds without coordinates never revoke pioneer status", () => {
    expect(isPioneer(tile, [find({ brand: "Nintendo" }), find({ brand: "Roblox" })])).toBe(true);
  });

  test("tile matching is case- and whitespace-insensitive", () => {
    expect(isPioneer(` ${tile.toUpperCase()} `, [find({ brand: "Chipotle", ...SF })])).toBe(false);
  });
});

describe("completion", () => {
  test("counts distinct tickers on both sides and intersects them", () => {
    const result = completion(["SBUX", "MCD", "SBUX", "KO"], ["SBUX", "KO", "AAPL"]);
    // SBUX twice on the block is still one investable.
    expect(result.investablesTotal).toBe(3);
    // AAPL is caught but not on this block — it must not inflate the tile.
    expect(result.found).toBe(2);
  });

  test("found can never exceed investablesTotal", () => {
    const result = completion(["SBUX"], ["SBUX", "MCD", "KO", "AAPL"]);
    expect(result.investablesTotal).toBe(1);
    expect(result.found).toBe(1);
    expect(result.found).toBeLessThanOrEqual(result.investablesTotal);
  });

  test("normalizes case and whitespace, and drops empty entries", () => {
    const result = completion([" sbux ", "MCD", "", null, undefined], ["Sbux", "  "]);
    expect(result.investablesTotal).toBe(2);
    expect(result.found).toBe(1);
  });

  test("an empty tile is 0/0, not a divide-by-zero or a fabricated total", () => {
    expect(completion([], ["SBUX"])).toEqual({ investablesTotal: 0, found: 0 });
  });

  test("a fully-collected tile reaches parity", () => {
    const result = completion(["SBUX", "MCD"], ["MCD", "SBUX"]);
    expect(result).toEqual({ investablesTotal: 2, found: 2 });
  });
});

describe("TerritoryResponse shape", () => {
  test("a route-shaped payload parses against the core schema", () => {
    const tile = tileFor(SF.lat, SF.lng);
    const { investablesTotal, found } = completion(["SBUX", "MCD", "KO"], ["SBUX"]);
    const payload = {
      tile,
      investablesTotal,
      found,
      pioneer: isPioneer(tile, []),
      sources: [
        {
          provider: "exa" as const,
          url: "https://www.starbucks.com/",
          fetchedAt: "2026-08-20T00:00:00.000Z",
          confidence: "high" as const,
        },
      ],
    };
    const parsed = TerritoryResponse.parse(payload);
    expect(parsed.tile).toBe(tile);
    expect(parsed.investablesTotal).toBe(3);
    expect(parsed.found).toBe(1);
    expect(parsed.pioneer).toBe(true);
  });

  test("an uncitable tile carries an empty sources array, not an invented one", () => {
    const parsed = TerritoryResponse.parse({
      tile: tileFor(SF.lat, SF.lng),
      investablesTotal: 0,
      found: 0,
      pioneer: true,
      sources: [],
    });
    expect(parsed.sources).toEqual([]);
  });
});

describe("PIONEER_XP", () => {
  test("is a positive whole number of XP", () => {
    expect(PIONEER_XP).toBe(15);
    expect(Number.isInteger(PIONEER_XP)).toBe(true);
  });
});

/**
 * In-memory store path (POSTGRES_URL unset in the test env). Covers the A6
 * write-time contract: the tile is stamped on the row, tile queries find it,
 * and the pioneer bonus is granted exactly once per tile.
 */
describe("finds-store territory column (in-memory)", () => {
  const userId = () => `u_territory_${Math.random().toString(36).slice(2)}`;

  test("recordFind stamps geohash6 from coords and leaves it off coordless finds", async () => {
    const uid = userId();
    const withCoords = await recordFind(uid, {
      brand: "Chipotle",
      ticker: "CMG",
      isPublic: true,
      confidence: "high",
      lat: SF.lat,
      lng: SF.lng,
    });
    const without = await recordFind(uid, {
      brand: "Nintendo",
      ticker: "NTDOY",
      isPublic: true,
      confidence: "high",
    });
    expect(withCoords.geohash6).toBe(tileFor(SF.lat, SF.lng));
    expect(without.geohash6).toBeUndefined();
    // The wire shape is untouched — geohash6 is server-internal.
    expect(Find.parse(withCoords).id).toBe(withCoords.id);
  });

  test("findsInTile returns only the finds inside that tile", async () => {
    const uid = userId();
    await recordFind(uid, {
      brand: "Chipotle",
      ticker: "CMG",
      isPublic: true,
      confidence: "high",
      lat: SF.lat,
      lng: SF.lng,
    });
    await recordFind(uid, {
      brand: "Shake Shack",
      ticker: "SHAK",
      isPublic: true,
      confidence: "high",
      lat: NYC.lat,
      lng: NYC.lng,
    });
    await recordFind(uid, {
      brand: "Nintendo",
      ticker: "NTDOY",
      isPublic: true,
      confidence: "high",
    });

    const sfTile = tileFor(SF.lat, SF.lng);
    const inSf = await findsInTile(uid, sfTile);
    expect(inSf.map((f) => f.brand)).toEqual(["Chipotle"]);
    expect(isPioneer(sfTile, inSf)).toBe(false);
    expect(isPioneer(tileFor(0, 0), await findsInTile(uid, tileFor(0, 0)))).toBe(true);
  });

  test("the pioneer bonus is granted once per tile, not once per find", async () => {
    const uid = userId();
    const tile = tileFor(SF.lat, SF.lng);
    await recordFind(uid, {
      brand: "Chipotle",
      ticker: "CMG",
      isPublic: true,
      confidence: "high",
      lat: SF.lat,
      lng: SF.lng,
    });
    await recordFind(uid, {
      brand: "Blue Bottle",
      comparable: "SBUX",
      isPublic: false,
      confidence: "medium",
      lat: SF.lat + 0.00005,
      lng: SF.lng,
    });
    // recordFind fires the award without awaiting it — let the microtasks run.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The grant key is claimed, so a direct re-award is a no-op forever.
    expect(await awardXp(uid, PIONEER_XP, `pioneer:${tile}`)).toBe(false);
    // A tile they have never caught in is still unclaimed.
    expect(await awardXp(uid, PIONEER_XP, `pioneer:${tileFor(0, 0)}`)).toBe(true);
  });
});
