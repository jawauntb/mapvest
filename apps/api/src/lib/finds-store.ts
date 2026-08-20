/**
 * Per-user "finds journal" — every successful /v1/identify by a signed-in
 * user records its top investable here. The universe is companies, not snaps:
 * one row per effective ticker (public ticker, else comparable, else brand).
 * Recatching the same ticker still bumps streak/XP but does not insert again.
 *
 * Postgres when POSTGRES_URL is set (Railway); in-memory fallback for local
 * tests. Follows the pattern of `saved-locations-store.ts` — table is created
 * lazily via `CREATE TABLE IF NOT EXISTS` the first time the store is touched
 * (no migrations runner, matching the rest of the codebase).
 *
 * Table:
 *   user_finds(
 *     id uuid PK, user_id text, brand text,
 *     ticker text, is_public boolean, comparable text,
 *     confidence text,
 *     lat double precision, lng double precision,
 *     found_price double precision,
 *     geohash6 text,                    -- territory tile (A6), server-internal
 *     created_at timestamptz default now()
 *   )
 *
 * `geohash6` is the territory tile (Universe Roadmap §1 A6): the same
 * precision-6 cell the nearby cache and the regional dex key on, computed from
 * the find's coordinates at write time so tile queries are an indexed equality
 * instead of a full-table scan through a JS geohash. It stays SERVER-INTERNAL —
 * the core `Find` schema is untouched and the wire shape does not change; only
 * `StoredFind` (this module's internal type) exposes it. Rows written before
 * the column existed carry NULL and are computed on read from lat/lng.
 */
import type { Confidence, Find } from "@mapvest/core";
import { dbEnabled, getSql, initDb } from "./db.js";
import { awardXp, bumpProgressOnFind } from "./progress-store.js";
import { PIONEER_XP, tileFor } from "./territory.js";

/**
 * A journal row as this module holds it: the wire `Find` plus the internal
 * territory tile. Never widened into `@mapvest/core` — routes serialize the
 * `Find` fields and use `geohash6` only for tile queries.
 */
export type StoredFind = Find & { geohash6?: string };

export type FindInput = {
  brand: string;
  ticker?: string;
  isPublic?: boolean;
  comparable?: string;
  confidence: Confidence;
  lat?: number;
  lng?: number;
  foundPrice?: number;
};

/** Memory fallback keeps at most this many finds per user (newest win). */
const MEMORY_CAP = 500;

// userId -> finds, newest first.
const memory = new Map<string, StoredFind[]>();

function memBucket(userId: string): StoredFind[] {
  let arr = memory.get(userId);
  if (!arr) {
    arr = [];
    memory.set(userId, arr);
  }
  return arr;
}

/** Territory tile for a find's coordinates, or undefined when it has none. */
export function geohashForCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
): string | undefined {
  if (typeof lat !== "number" || !Number.isFinite(lat)) return undefined;
  if (typeof lng !== "number" || !Number.isFinite(lng)) return undefined;
  return tileFor(lat, lng);
}

let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await initDb();
  if (!dbEnabled()) {
    tableEnsured = true;
    return;
  }
  const sql = getSql();
  if (!sql) return;
  await sql`
    CREATE TABLE IF NOT EXISTS user_finds (
      id UUID PRIMARY KEY,
      user_id TEXT NOT NULL,
      brand TEXT NOT NULL,
      ticker TEXT,
      is_public BOOLEAN,
      comparable TEXT,
      confidence TEXT NOT NULL,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      found_price DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // A1 shipped this table without `geohash6`; add it in place rather than
  // through a migrations runner (same posture as progress-store's `badges`).
  // Existing rows stay NULL — `rowToFind` recomputes them from lat/lng.
  await sql`ALTER TABLE user_finds ADD COLUMN IF NOT EXISTS geohash6 TEXT`;
  await sql`
    CREATE INDEX IF NOT EXISTS user_finds_user_idx
      ON user_finds (user_id, created_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS user_finds_tile_idx
      ON user_finds (user_id, geohash6)
  `;
  tableEnsured = true;
}

/** Dex / universe identity: ticker, else comparable, else brand. */
export function findIdentityKey(find: {
  brand: string;
  ticker?: string | null;
  comparable?: string | null;
}): string {
  const symbol = (find.ticker ?? find.comparable ?? "").trim().toUpperCase();
  return symbol || find.brand.trim().toUpperCase();
}

/** Newest-first list with at most one find per identity key. */
export function uniqueFindsNewestFirst<T extends Find>(finds: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const find of finds) {
    const key = findIdentityKey(find);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(find);
  }
  return out;
}

function rowToFind(row: {
  id: string;
  brand: string;
  ticker: string | null;
  is_public: boolean | null;
  comparable: string | null;
  confidence: string;
  lat: number | null;
  lng: number | null;
  found_price: number | null;
  geohash6?: string | null;
  created_at: Date | string;
}): StoredFind {
  const createdAt =
    typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString();
  // Compute-on-read fallback for rows written before the column existed.
  const geohash6 = row.geohash6 ?? geohashForCoords(row.lat, row.lng);
  return {
    ...(geohash6 ? { geohash6 } : {}),
    id: row.id,
    brand: row.brand,
    ticker: row.ticker ?? undefined,
    isPublic: row.is_public ?? undefined,
    comparable: row.comparable ?? undefined,
    confidence: row.confidence as Confidence,
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    foundPrice: row.found_price ?? undefined,
    createdAt,
  };
}

async function existingFindForKey(userId: string, key: string): Promise<StoredFind | undefined> {
  const fromMem = memBucket(userId).find((row) => findIdentityKey(row) === key);
  if (fromMem) return fromMem;
  if (!dbEnabled()) return undefined;
  const sql = getSql();
  if (!sql) return undefined;
  const rows = await sql`
    SELECT id, brand, ticker, is_public, comparable, confidence,
           lat, lng, found_price, geohash6, created_at
    FROM user_finds
    WHERE user_id = ${userId}
      AND COALESCE(
        NULLIF(UPPER(TRIM(ticker)), ''),
        NULLIF(UPPER(TRIM(comparable)), ''),
        UPPER(TRIM(brand))
      ) = ${key}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const row = (rows as Array<Parameters<typeof rowToFind>[0]>)[0];
  return row ? rowToFind(row) : undefined;
}

export async function recordFind(userId: string, find: FindInput): Promise<StoredFind> {
  await ensureTable();
  const now = new Date().toISOString();
  const existing = await existingFindForKey(userId, findIdentityKey(find));
  const geohash6 = geohashForCoords(find.lat, find.lng);
  // Recatch still counts for streak/XP; the journal stays one card per company.
  // The brand/ticker context lets the event system apply a Sector Saturday
  // multiplier to the find's XP (Universe Roadmap §1 A7).
  //
  // The pioneer grant is SEQUENCED after the streak bump, not raced beside it:
  // both paths end in a full-row upsert of user_progress, so two concurrent
  // read-modify-writes in one request could clobber each other (the pioneer
  // write reverting the just-advanced streak). Still fire-and-forget as a
  // whole — a progression write must never fail an identify. A recatch in a
  // brand-new tile claims the pioneer grant too (`awardXp` is idempotent on
  // the grant key, so re-claims are free).
  bumpProgressOnFind(userId, now, {
    brand: find.brand,
    ticker: find.ticker,
    comparable: find.comparable,
  })
    .then(() => (geohash6 ? awardXp(userId, PIONEER_XP, `pioneer:${geohash6}`) : false))
    .catch(() => {});
  if (existing) return existing;
  const entry: StoredFind = {
    id: crypto.randomUUID(),
    brand: find.brand,
    ticker: find.ticker,
    isPublic: find.isPublic,
    comparable: find.comparable,
    confidence: find.confidence,
    lat: find.lat,
    lng: find.lng,
    foundPrice: find.foundPrice,
    ...(geohash6 ? { geohash6 } : {}),
    createdAt: now,
  };
  const bucket = memBucket(userId);
  bucket.unshift(entry);
  if (bucket.length > MEMORY_CAP) bucket.length = MEMORY_CAP;
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      await sql`
        INSERT INTO user_finds (
          id, user_id, brand, ticker, is_public, comparable, confidence,
          lat, lng, found_price, geohash6, created_at
        ) VALUES (
          ${entry.id},
          ${userId},
          ${entry.brand},
          ${entry.ticker ?? null},
          ${entry.isPublic ?? null},
          ${entry.comparable ?? null},
          ${entry.confidence},
          ${entry.lat ?? null},
          ${entry.lng ?? null},
          ${entry.foundPrice ?? null},
          ${entry.geohash6 ?? null},
          ${new Date(entry.createdAt)}
        )
      `;
    }
  }

  // Pioneer bonus (Universe Roadmap §1 A6) is granted in the sequenced
  // progression chain above, after the streak bump — see the comment there.
  return entry;
}

/**
 * Every find the user recorded inside a geohash-6 tile (Universe Roadmap §1
 * A6). Backs the `pioneer` flag on `GET /v1/territory`: an empty result means
 * the next find here is their first in this neighborhood.
 *
 * Rows written before the `geohash6` column existed carry NULL, so the query
 * also pulls coordinate-bearing NULL rows and filters them in JS against the
 * recomputed tile — the same compute-on-read fallback `rowToFind` applies.
 */
export async function findsInTile(userId: string, tile: string): Promise<StoredFind[]> {
  await ensureTable();
  const target = tile.trim().toLowerCase();
  if (!target) return [];
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = await sql`
        SELECT id, brand, ticker, is_public, comparable, confidence,
               lat, lng, found_price, geohash6, created_at
        FROM user_finds
        WHERE user_id = ${userId}
          AND (
            geohash6 = ${target}
            OR (geohash6 IS NULL AND lat IS NOT NULL AND lng IS NOT NULL)
          )
        ORDER BY created_at DESC
        LIMIT 500
      `;
      return (rows as Array<Parameters<typeof rowToFind>[0]>)
        .map(rowToFind)
        .filter((f) => f.geohash6 === target);
    }
  }
  return memBucket(userId).filter((f) => (f.geohash6 ?? geohashForCoords(f.lat, f.lng)) === target);
}

export async function listFinds(userId: string, limit = 100): Promise<StoredFind[]> {
  await ensureTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = await sql`
        SELECT id, brand, ticker, is_public, comparable, confidence,
               lat, lng, found_price, geohash6, created_at
        FROM (
          SELECT DISTINCT ON (
            COALESCE(
              NULLIF(UPPER(TRIM(ticker)), ''),
              NULLIF(UPPER(TRIM(comparable)), ''),
              UPPER(TRIM(brand))
            )
          )
            id, brand, ticker, is_public, comparable, confidence,
            lat, lng, found_price, geohash6, created_at
          FROM user_finds
          WHERE user_id = ${userId}
          ORDER BY
            COALESCE(
              NULLIF(UPPER(TRIM(ticker)), ''),
              NULLIF(UPPER(TRIM(comparable)), ''),
              UPPER(TRIM(brand))
            ),
            created_at DESC
        ) uniq
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      return (rows as Array<Parameters<typeof rowToFind>[0]>).map(rowToFind);
    }
  }
  return uniqueFindsNewestFirst(memBucket(userId)).slice(0, limit);
}
