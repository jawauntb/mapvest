/**
 * The Dex — collection structure + rarity (Universe Roadmap §1 A4).
 *
 * Everything here is a PURE function over injected data: the caller hands in
 * the user's `Find[]` and the brand seed, and gets back the `DexResponse`
 * shape from `@mapvest/core`. Nothing in this file touches a store, the
 * network, or `process.env`, so the unit tests need no database and no
 * fixtures beyond plain object literals.
 *
 * The dex is derived on read — it is never written. `GET /v1/dex`
 * (routes/dex.ts) reconciles `user_finds` against `brands.json` on every
 * request, so it cannot drift from the journal.
 *
 * Counting unit (important): a "brand" for dex purposes is a DISTINCT TICKER,
 * on both sides of the ratio. The seed is alias-heavy — "mcdonald's" and
 * "mcdonalds" are two entries pointing at the same MCD — so counting raw seed
 * entries as the denominator would make the ratio unreachable (a user who
 * caught literally every brand in the seed would still read ~492/1101, and
 * the A4 completion badges could never fire). `found` counts distinct
 * effective tickers; `total` counts distinct seed tickers. Same unit, so the
 * fraction reconciles and completion is attainable.
 */
import type { DexRarity, DexRarityCounts, DexSector, Find } from "@mapvest/core";
import { canonicalSector } from "@mapvest/finance";
import { encodeGeohash } from "./geohash.js";

/**
 * Structural shape of a seed map, so callers can inject `seedBrands` from
 * `@mapvest/finance` in production and a two-line literal in tests.
 */
export type DexSeedEntry = {
  ticker: string;
  sector?: string;
};
export type DexSeed = Record<string, DexSeedEntry>;

/** Bucket used for seed entries whose sector is missing or unrecognized. */
export const UNKNOWN_SECTOR = "Unknown";

/** Uppercase + trim a ticker so seed/find comparisons are symmetric. */
function normalizeTicker(input: string | undefined | null): string | null {
  if (!input) return null;
  const t = input.trim().toUpperCase();
  return t.length > 0 ? t : null;
}

/** Canonical GICS sector for a seed entry, falling back to `UNKNOWN_SECTOR`. */
function sectorOf(entry: DexSeedEntry): string {
  return canonicalSector(entry.sector) ?? UNKNOWN_SECTOR;
}

/**
 * The ticker a find actually represents: its own ticker when public, otherwise
 * the public comparable resolved for a private brand. This is what gets
 * matched against the seed.
 */
export function effectiveTicker(find: Find): string | null {
  return normalizeTicker(find.ticker) ?? normalizeTicker(find.comparable);
}

/**
 * ticker -> canonical sector, collapsing the seed's brand aliases. First
 * sector seen for a ticker wins (the seed is add-only and single-sector per
 * ticker in practice; this just makes the fold deterministic).
 */
export function seedTickerSectors(seed: DexSeed): Map<string, string> {
  const bySector = new Map<string, string>();
  for (const entry of Object.values(seed)) {
    const ticker = normalizeTicker(entry.ticker);
    if (!ticker) continue;
    if (!bySector.has(ticker)) bySector.set(ticker, sectorOf(entry));
  }
  return bySector;
}

/**
 * Canonical sector -> number of distinct seed tickers in it. This is the
 * denominator of each sector row ("Consumer Staples — 14/50 found").
 */
export function sectorTotals(seed: DexSeed): Map<string, number> {
  const totals = new Map<string, number>();
  for (const sector of seedTickerSectors(seed).values()) {
    totals.set(sector, (totals.get(sector) ?? 0) + 1);
  }
  return totals;
}

/** True when the find's effective ticker matches a seed entry's ticker. */
export function isInSeed(find: Find, seed: DexSeed): boolean {
  const ticker = effectiveTicker(find);
  if (!ticker) return false;
  return seedTickerSectors(seed).has(ticker);
}

/**
 * Regional dex: distinct geohash-6 tiles with at least one find. Finds
 * missing either coordinate are skipped rather than defaulted to 0,0 —
 * a null island tile would be fabricated data.
 */
export function tilesVisited(finds: Find[]): Set<string> {
  const tiles = new Set<string>();
  for (const find of finds) {
    const { lat, lng } = find;
    if (typeof lat !== "number" || !Number.isFinite(lat)) continue;
    if (typeof lng !== "number" || !Number.isFinite(lng)) continue;
    tiles.add(encodeGeohash(lat, lng, 6));
  }
  return tiles;
}

/**
 * Rarity tier for a single catch. `inSeed` is injected (compute it with
 * `isInSeed`) so this stays a pure branch over data already on the find.
 *
 * "uncommon" is reserved for a later market-cap pass that will split public
 * catches into mega-cap (common) and small-cap (uncommon); it is never
 * returned today because no market-cap data reaches this function.
 */
export function rarityForFind(find: Find, inSeed: boolean): DexRarity {
  // Resolved by the vision pipeline but absent from brands.json — this catch
  // is what feeds the seed table (roadmap A4, the data flywheel).
  if (!inSeed) return "legendary";
  if (find.isPublic === false) return "rare";
  return "common";
}

/**
 * Collection identity of a find: its effective ticker, else the normalized
 * brand. Mirrors `findIdentityKey` in finds-store — the journal is already
 * unique on this key, so classifying by it keeps the rarity histogram in the
 * same counting unit as the rest of the dex (one entry per company caught,
 * not one per snapshot).
 */
function identityKey(find: Find): string {
  return effectiveTicker(find) ?? find.brand.trim().toUpperCase();
}

/**
 * Per-catch rarity histogram. One classification per distinct identity — over
 * the journal `GET /v1/dex` reads (already unique per identity) the four
 * counts sum exactly to `totalFinds`, which is the invariant the
 * `DexRarityCounts` schema documents.
 *
 * `uncommon` is always 0 today: `rarityForFind` reserves it for the later
 * market-cap split, and inventing a market cap to fill it would be fabricated
 * data (AGENTS.md §2.4).
 */
export function rarityCounts(finds: Find[], seed: DexSeed): DexRarityCounts {
  const tickerSectors = seedTickerSectors(seed);
  const counts: DexRarityCounts = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
  const seen = new Set<string>();
  for (const find of finds) {
    const key = identityKey(find);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const ticker = effectiveTicker(find);
    const inSeed = ticker !== null && tickerSectors.has(ticker);
    counts[rarityForFind(find, inSeed)] += 1;
  }
  return counts;
}

/**
 * Build the full dex from a user's finds and the brand seed.
 *
 * - `sectors`: every sector present in the seed, sorted by name, with `found`
 *   = distinct effective tickers caught in that sector and `total` = distinct
 *   seed tickers in it. Sectors with zero catches are still listed — an empty
 *   ring is the whole point of a dex.
 * - `tilesVisited`: distinct geohash-6 cells across finds that carry coords.
 * - `totalFinds`: every find, including ones that match no seed entry.
 * - `rarityCounts`: the per-catch rarity histogram (see `rarityCounts`).
 */
export function computeDex(
  finds: Find[],
  seed: DexSeed,
): {
  sectors: DexSector[];
  tilesVisited: number;
  totalFinds: number;
  rarityCounts: DexRarityCounts;
} {
  const tickerSectors = seedTickerSectors(seed);
  const totals = sectorTotals(seed);

  // sector -> set of distinct tickers caught, so duplicate catches of the
  // same brand (or of two aliases of it) count once.
  const caught = new Map<string, Set<string>>();
  for (const find of finds) {
    const ticker = effectiveTicker(find);
    if (!ticker) continue;
    const sector = tickerSectors.get(ticker);
    if (!sector) continue; // legendary: not in the seed, so no sector row yet
    let bucket = caught.get(sector);
    if (!bucket) {
      bucket = new Set<string>();
      caught.set(sector, bucket);
    }
    bucket.add(ticker);
  }

  const sectors: DexSector[] = [...totals.entries()]
    .map(([sector, total]) => ({
      sector,
      found: caught.get(sector)?.size ?? 0,
      total,
    }))
    .sort((a, b) => a.sector.localeCompare(b.sector));

  return {
    sectors,
    tilesVisited: tilesVisited(finds).size,
    totalFinds: finds.length,
    rarityCounts: rarityCounts(finds, seed),
  };
}
