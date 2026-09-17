/**
 * Territory — geohash-6 tiles, pioneer detection, neighborhood completion
 * (Universe Roadmap §1 A6).
 *
 * Everything here is a PURE function over injected data: a lat/lng, a tile
 * string, a `Find[]`, or two ticker lists. Nothing touches a store, the
 * network, the clock, or `process.env`, so the unit tests need no database.
 *
 * The tile is the same geohash-6 cell (~1.2km × 0.6km) the nearby cache and
 * the regional dex already key on (`lib/geohash.ts`, `lib/dex.ts`), so
 * "neighborhood" means exactly one thing across the product.
 *
 * Two rules this module fixes:
 *
 * 1. **A tile is decided by coordinates, never by the client.** `tileFor` is
 *    the only way a tile is produced, and finds without coordinates are not
 *    in any tile — they never count for or against pioneer status.
 * 2. **Completion is a set intersection, not a running total.** `completion`
 *    counts DISTINCT tickers on both sides (same counting unit as the dex),
 *    so a block with two Starbucks is one investable, and the fraction can
 *    actually reach 1.
 */
import type { Find } from "@mapvest/core";
import { encodeGeohash } from "./geohash.js";

/** Geohash precision for a "neighborhood" tile — matches the nearby cache. */
export const TILE_PRECISION = 6;

/**
 * Nominal radius, in metres, of the circle that covers a geohash-6 tile.
 * A precision-6 cell is ~1.22km × 0.61km, so its half-diagonal is ~680m;
 * 700m covers the whole cell with a little slack for the places cascade.
 */
export const TILE_RADIUS_M = 700;

/** Base32 alphabet used by geohash (matches `lib/geohash.ts`). */
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** XP for the first find recorded in a tile (granted in `recordFind`). */
export const PIONEER_XP = 15;

/** The geohash-6 tile containing a coordinate. */
export function tileFor(lat: number, lng: number): string {
  return encodeGeohash(lat, lng, TILE_PRECISION);
}

/** The tile a find sits in, or null when it carries no usable coordinates. */
export function tileOfFind(find: Pick<Find, "lat" | "lng">): string | null {
  const { lat, lng } = find;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
  if (typeof lng !== "number" || !Number.isFinite(lng)) return null;
  return tileFor(lat, lng);
}

/**
 * Decode a geohash to its bounding box, or null if the string is not a valid
 * geohash. Inverse of `encodeGeohash` — same bit interleaving, read back.
 */
export function tileBounds(
  tile: string,
): { latMin: number; latMax: number; lngMin: number; lngMax: number } | null {
  const hash = tile.trim().toLowerCase();
  if (!hash) return null;
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let even = true;
  for (const ch of hash) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) return null;
    for (let bit = 4; bit >= 0; bit--) {
      const on = (idx >> bit) & 1;
      if (even) {
        const mid = (lngMin + lngMax) / 2;
        if (on) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (on) latMin = mid;
        else latMax = mid;
      }
      even = !even;
    }
  }
  return { latMin, latMax, lngMin, lngMax };
}

/**
 * Centre of a tile — the point the nearby cascade is run from so the places
 * lookup is about the tile, not about wherever inside it the user is standing.
 * Two users on opposite corners of the same block therefore see the same
 * denominator.
 */
export function tileCenter(tile: string): { lat: number; lng: number } | null {
  const bounds = tileBounds(tile);
  if (!bounds) return null;
  return {
    lat: (bounds.latMin + bounds.latMax) / 2,
    lng: (bounds.lngMin + bounds.lngMax) / 2,
  };
}

/**
 * True when none of `priorFinds` was recorded inside `tile` — i.e. the next
 * find here is the user's first in this neighborhood.
 *
 * Finds without coordinates belong to no tile and are ignored rather than
 * treated as "somewhere else": absence of a coordinate is not evidence.
 */
export function isPioneer(tile: string, priorFinds: readonly Find[]): boolean {
  const target = tile.trim().toLowerCase();
  if (!target) return false;
  for (const find of priorFinds) {
    if (tileOfFind(find) === target) return false;
  }
  return true;
}

/** Uppercase + trim a ticker so both sides of the ratio compare symmetrically. */
function normalizeTicker(input: string | undefined | null): string | null {
  if (!input) return null;
  const t = input.trim().toUpperCase();
  return t.length > 0 ? t : null;
}

/**
 * Neighborhood completion: "6 of 11 investable brands found in this tile".
 *
 * `investableTickers` are the distinct public tickers the nearby cascade
 * resolved inside the tile (the denominator); `findTickers` are the caller's
 * effective tickers from the journal (ticker, else comparable). `found` is
 * the intersection, so it can never exceed `investablesTotal` — a user who
 * caught a company that is not on this block does not inflate the tile.
 */
export function completion(
  investableTickers: readonly (string | undefined | null)[],
  findTickers: readonly (string | undefined | null)[],
): { investablesTotal: number; found: number } {
  const investables = new Set<string>();
  for (const raw of investableTickers) {
    const t = normalizeTicker(raw);
    if (t) investables.add(t);
  }
  const caught = new Set<string>();
  for (const raw of findTickers) {
    const t = normalizeTicker(raw);
    if (t && investables.has(t)) caught.add(t);
  }
  return { investablesTotal: investables.size, found: caught.size };
}
