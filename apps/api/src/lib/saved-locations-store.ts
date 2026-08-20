/**
 * Per-user "Location folder" — saved Local Economy Briefs.
 *
 * Postgres when POSTGRES_URL is set (Railway); in-memory fallback for local
 * tests. Follows the pattern of `watchlist-store.ts` — table is created on
 * first `initDb()` call via a `CREATE TABLE IF NOT EXISTS` executed inline
 * the first time the store is touched (so it works without a migrations
 * runner, matching the rest of the codebase).
 *
 * Table:
 *   saved_local_briefs(
 *     id text PK, user_id text, label text,
 *     lat double precision, lng double precision,
 *     city text, state text, zip text,
 *     brief text,           -- the full 3-paragraph markdown
 *     created_at timestamptz default now()
 *   )
 */
import { dbEnabled, getSql, initDb } from "./db.js";

export type SavedLocalBrief = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  city?: string;
  state?: string;
  zip?: string;
  brief: string;
  createdAt: string; // ISO
};

const memory = new Map<string, Map<string, SavedLocalBrief>>();

function memBucket(userId: string): Map<string, SavedLocalBrief> {
  let m = memory.get(userId);
  if (!m) {
    m = new Map();
    memory.set(userId, m);
  }
  return m;
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
    CREATE TABLE IF NOT EXISTS saved_local_briefs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      city TEXT,
      state TEXT,
      zip TEXT,
      brief TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS saved_local_briefs_user_idx
      ON saved_local_briefs (user_id, created_at DESC)
  `;
  tableEnsured = true;
}

function rowToBrief(row: {
  id: string;
  label: string;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
  zip: string | null;
  brief: string;
  created_at: Date | string;
}): SavedLocalBrief {
  const createdAt =
    typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString();
  return {
    id: row.id,
    label: row.label,
    lat: row.lat,
    lng: row.lng,
    city: row.city ?? undefined,
    state: row.state ?? undefined,
    zip: row.zip ?? undefined,
    brief: row.brief,
    createdAt,
  };
}

function newId(): string {
  // Same shape used across watchlist / alerts stores — short URL-safe.
  return `slb_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export async function saveLocalBrief(
  userId: string,
  input: {
    label: string;
    lat: number;
    lng: number;
    city?: string;
    state?: string;
    zip?: string;
    brief: string;
  },
): Promise<SavedLocalBrief> {
  await ensureTable();
  const id = newId();
  const createdAt = new Date().toISOString();
  const entry: SavedLocalBrief = {
    id,
    label: input.label,
    lat: input.lat,
    lng: input.lng,
    city: input.city,
    state: input.state,
    zip: input.zip,
    brief: input.brief,
    createdAt,
  };
  memBucket(userId).set(id, entry);
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      await sql`
        INSERT INTO saved_local_briefs (
          id, user_id, label, lat, lng, city, state, zip, brief, created_at
        ) VALUES (
          ${id},
          ${userId},
          ${entry.label},
          ${entry.lat},
          ${entry.lng},
          ${entry.city ?? null},
          ${entry.state ?? null},
          ${entry.zip ?? null},
          ${entry.brief},
          ${new Date(createdAt)}
        )
      `;
    }
  }
  return entry;
}

export async function listSavedLocalBriefs(userId: string): Promise<SavedLocalBrief[]> {
  await ensureTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = await sql`
        SELECT id, label, lat, lng, city, state, zip, brief, created_at
        FROM saved_local_briefs
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `;
      const items = (rows as Array<Parameters<typeof rowToBrief>[0]>).map(rowToBrief);
      const m = memBucket(userId);
      m.clear();
      for (const e of items) m.set(e.id, e);
      return items;
    }
  }
  return [...memBucket(userId).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteSavedLocalBrief(userId: string, id: string): Promise<boolean> {
  await ensureTable();
  const removedMem = memBucket(userId).delete(id);
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = await sql`
        DELETE FROM saved_local_briefs
        WHERE user_id = ${userId} AND id = ${id}
        RETURNING id
      `;
      return (rows as unknown[]).length > 0 || removedMem;
    }
  }
  return removedMem;
}
