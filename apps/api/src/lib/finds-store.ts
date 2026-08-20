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
 *     created_at timestamptz default now()
 *   )
 */
import type { Confidence, Find } from "@mapvest/core";
import { dbEnabled, getSql, initDb } from "./db.js";
import { bumpProgressOnFind } from "./progress-store.js";

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
const memory = new Map<string, Find[]>();

function memBucket(userId: string): Find[] {
  let arr = memory.get(userId);
  if (!arr) {
    arr = [];
    memory.set(userId, arr);
  }
  return arr;
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
  await sql`
    CREATE INDEX IF NOT EXISTS user_finds_user_idx
      ON user_finds (user_id, created_at DESC)
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
export function uniqueFindsNewestFirst(finds: Find[]): Find[] {
  const seen = new Set<string>();
  const out: Find[] = [];
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
  created_at: Date | string;
}): Find {
  const createdAt =
    typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString();
  return {
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

async function existingFindForKey(userId: string, key: string): Promise<Find | undefined> {
  const fromMem = memBucket(userId).find((row) => findIdentityKey(row) === key);
  if (fromMem) return fromMem;
  if (!dbEnabled()) return undefined;
  const sql = getSql();
  if (!sql) return undefined;
  const rows = await sql`
    SELECT id, brand, ticker, is_public, comparable, confidence,
           lat, lng, found_price, created_at
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

export async function recordFind(userId: string, find: FindInput): Promise<Find> {
  await ensureTable();
  const now = new Date().toISOString();
  const existing = await existingFindForKey(userId, findIdentityKey(find));
  // Recatch still counts for streak/XP; the journal stays one card per company.
  bumpProgressOnFind(userId, now).catch(() => {});
  if (existing) return existing;

  const entry: Find = {
    id: crypto.randomUUID(),
    brand: find.brand,
    ticker: find.ticker,
    isPublic: find.isPublic,
    comparable: find.comparable,
    confidence: find.confidence,
    lat: find.lat,
    lng: find.lng,
    foundPrice: find.foundPrice,
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
          lat, lng, found_price, created_at
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
          ${new Date(entry.createdAt)}
        )
      `;
    }
  }
  return entry;
}

export async function listFinds(userId: string, limit = 100): Promise<Find[]> {
  await ensureTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = await sql`
        SELECT id, brand, ticker, is_public, comparable, confidence,
               lat, lng, found_price, created_at
        FROM (
          SELECT DISTINCT ON (
            COALESCE(
              NULLIF(UPPER(TRIM(ticker)), ''),
              NULLIF(UPPER(TRIM(comparable)), ''),
              UPPER(TRIM(brand))
            )
          )
            id, brand, ticker, is_public, comparable, confidence,
            lat, lng, found_price, created_at
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
