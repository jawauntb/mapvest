/**
 * Per-user watchlist persistence.
 * Postgres when POSTGRES_URL is set; otherwise in-memory (tests / local).
 *
 * Phase: Multiple Watchlists.
 *   - New `watchlist_lists` table holds named lists per user.
 *   - `user_watchlist` gains a `list_id` column (nullable — legacy rows are
 *     treated as belonging to the user's default list on first read).
 *   - Because the primary key is (user_id, ticker), a ticker lives in at
 *     most one list at a time. "Move" is just an UPDATE of list_id.
 */
import { dbEnabled, getSql, initDb } from "./db.js";

export type WatchEntry = {
  ticker: string;
  name?: string;
  sector?: string;
  source: "camera" | "map" | "list" | "manual" | "detail" | "live" | "web";
  memo?: string;
  memoProvider?: string;
  createdAt: string; // ISO
  listId?: string;
};

export type WatchList = {
  id: string;
  userId: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
};

const memory = new Map<string, Map<string, WatchEntry>>();
// userId -> listId -> WatchList
const memoryLists = new Map<string, Map<string, WatchList>>();

function memBucket(userId: string): Map<string, WatchEntry> {
  let m = memory.get(userId);
  if (!m) {
    m = new Map();
    memory.set(userId, m);
  }
  return m;
}

function memListBucket(userId: string): Map<string, WatchList> {
  let m = memoryLists.get(userId);
  if (!m) {
    m = new Map();
    memoryLists.set(userId, m);
  }
  return m;
}

function rowToEntry(row: {
  ticker: string;
  name: string | null;
  sector: string | null;
  source: string;
  memo: string | null;
  memo_provider: string | null;
  created_at: Date | string;
  list_id?: string | null;
}): WatchEntry {
  const createdAt =
    typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString();
  return {
    ticker: row.ticker,
    name: row.name ?? undefined,
    sector: row.sector ?? undefined,
    source: row.source as WatchEntry["source"],
    memo: row.memo ?? undefined,
    memoProvider: row.memo_provider ?? undefined,
    createdAt,
    listId: row.list_id ?? undefined,
  };
}

// -------- migration helpers --------

let migratedListsDDL = false;
async function ensureListsDDL(): Promise<void> {
  if (migratedListsDDL) return;
  await initDb();
  if (!dbEnabled()) {
    migratedListsDDL = true;
    return;
  }
  const sql = getSql();
  if (!sql) {
    migratedListsDDL = true;
    return;
  }
  await sql`
    CREATE TABLE IF NOT EXISTS watchlist_lists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS watchlist_lists_user_idx ON watchlist_lists (user_id)`;
  await sql`ALTER TABLE user_watchlist ADD COLUMN IF NOT EXISTS list_id TEXT`;
  migratedListsDDL = true;
}

function newListId(): string {
  // Short opaque id — enough entropy for per-user uniqueness.
  return `wl_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/**
 * Ensures the user has at least one list marked `is_default`. Creates one
 * (idempotent) and back-fills `list_id` on any pre-existing watchlist rows
 * that were saved before multi-list support existed.
 */
export async function ensureDefaultList(userId: string): Promise<WatchList> {
  await ensureListsDDL();

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      // Look for an existing default.
      const rows = (await sql`
        SELECT id, user_id, name, is_default, created_at
        FROM watchlist_lists
        WHERE user_id = ${userId} AND is_default = true
        LIMIT 1
      `) as Array<{
        id: string;
        user_id: string;
        name: string;
        is_default: boolean;
        created_at: Date | string;
      }>;
      if (rows.length > 0) {
        const r = rows[0]!;
        const createdAt =
          typeof r.created_at === "string" ? r.created_at : r.created_at.toISOString();
        return {
          id: r.id,
          userId: r.user_id,
          name: r.name,
          isDefault: r.is_default,
          createdAt,
        };
      }
      // Create one and back-fill legacy watchlist rows.
      const id = newListId();
      const now = new Date();
      await sql`
        INSERT INTO watchlist_lists (id, user_id, name, is_default, created_at)
        VALUES (${id}, ${userId}, ${"Default"}, ${true}, ${now})
      `;
      await sql`
        UPDATE user_watchlist
        SET list_id = ${id}
        WHERE user_id = ${userId} AND list_id IS NULL
      `;
      return {
        id,
        userId,
        name: "Default",
        isDefault: true,
        createdAt: now.toISOString(),
      };
    }
  }

  // Memory fallback.
  const lists = memListBucket(userId);
  for (const l of lists.values()) {
    if (l.isDefault) return l;
  }
  const id = newListId();
  const list: WatchList = {
    id,
    userId,
    name: "Default",
    isDefault: true,
    createdAt: new Date().toISOString(),
  };
  lists.set(id, list);
  // Back-fill any pre-existing memory entries with no listId.
  for (const [, entry] of memBucket(userId)) {
    if (!entry.listId) entry.listId = id;
  }
  return list;
}

// -------- watch list CRUD --------

export async function listWatchLists(
  userId: string,
): Promise<Array<WatchList & { tickerCount: number }>> {
  await ensureListsDDL();
  // Make sure a default row exists (also back-fills legacy tickers).
  await ensureDefaultList(userId);

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        SELECT l.id, l.user_id, l.name, l.is_default, l.created_at,
               COALESCE(cnt.n, 0)::int AS ticker_count
        FROM watchlist_lists l
        LEFT JOIN (
          SELECT list_id, COUNT(*) AS n
          FROM user_watchlist
          WHERE user_id = ${userId}
          GROUP BY list_id
        ) cnt ON cnt.list_id = l.id
        WHERE l.user_id = ${userId}
        ORDER BY l.is_default DESC, l.created_at ASC
      `) as Array<{
        id: string;
        user_id: string;
        name: string;
        is_default: boolean;
        created_at: Date | string;
        ticker_count: number;
      }>;
      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        name: r.name,
        isDefault: r.is_default,
        createdAt:
          typeof r.created_at === "string" ? r.created_at : r.created_at.toISOString(),
        tickerCount: Number(r.ticker_count ?? 0),
      }));
    }
  }

  // Memory fallback.
  const lists = [...memListBucket(userId).values()].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
  const bucket = memBucket(userId);
  return lists.map((l) => ({
    ...l,
    tickerCount: [...bucket.values()].filter((e) => e.listId === l.id).length,
  }));
}

export async function createWatchList(userId: string, name: string): Promise<WatchList> {
  await ensureListsDDL();
  await ensureDefaultList(userId); // guarantees a default already exists first
  const trimmed = name.trim().slice(0, 60) || "Untitled";
  const id = newListId();
  const now = new Date();

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      await sql`
        INSERT INTO watchlist_lists (id, user_id, name, is_default, created_at)
        VALUES (${id}, ${userId}, ${trimmed}, ${false}, ${now})
      `;
      return {
        id,
        userId,
        name: trimmed,
        isDefault: false,
        createdAt: now.toISOString(),
      };
    }
  }

  const list: WatchList = {
    id,
    userId,
    name: trimmed,
    isDefault: false,
    createdAt: now.toISOString(),
  };
  memListBucket(userId).set(id, list);
  return list;
}

export async function renameWatchList(
  userId: string,
  listId: string,
  name: string,
): Promise<WatchList | null> {
  await ensureListsDDL();
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return null;

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        UPDATE watchlist_lists
        SET name = ${trimmed}
        WHERE id = ${listId} AND user_id = ${userId}
        RETURNING id, user_id, name, is_default, created_at
      `) as Array<{
        id: string;
        user_id: string;
        name: string;
        is_default: boolean;
        created_at: Date | string;
      }>;
      if (rows.length === 0) return null;
      const r = rows[0]!;
      return {
        id: r.id,
        userId: r.user_id,
        name: r.name,
        isDefault: r.is_default,
        createdAt:
          typeof r.created_at === "string" ? r.created_at : r.created_at.toISOString(),
      };
    }
  }

  const bucket = memListBucket(userId);
  const list = bucket.get(listId);
  if (!list) return null;
  list.name = trimmed;
  return list;
}

/**
 * Deletes a list and any tickers within it.
 * Returns `{ ok: false, reason: 'default' }` when caller tries to delete the
 * default list — callers surface this as 400.
 */
export async function deleteWatchList(
  userId: string,
  listId: string,
): Promise<{ ok: true } | { ok: false; reason: "default" | "not_found" }> {
  await ensureListsDDL();

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        SELECT is_default FROM watchlist_lists
        WHERE id = ${listId} AND user_id = ${userId}
        LIMIT 1
      `) as Array<{ is_default: boolean }>;
      if (rows.length === 0) return { ok: false, reason: "not_found" };
      if (rows[0]!.is_default) return { ok: false, reason: "default" };
      await sql`
        DELETE FROM user_watchlist
        WHERE user_id = ${userId} AND list_id = ${listId}
      `;
      await sql`
        DELETE FROM watchlist_lists
        WHERE id = ${listId} AND user_id = ${userId}
      `;
      // Drop from in-process memory too so subsequent reads reflect the delete.
      const memL = memListBucket(userId);
      memL.delete(listId);
      const memE = memBucket(userId);
      for (const [k, v] of memE) {
        if (v.listId === listId) memE.delete(k);
      }
      return { ok: true };
    }
  }

  const bucket = memListBucket(userId);
  const list = bucket.get(listId);
  if (!list) return { ok: false, reason: "not_found" };
  if (list.isDefault) return { ok: false, reason: "default" };
  bucket.delete(listId);
  const entries = memBucket(userId);
  for (const [k, v] of entries) {
    if (v.listId === listId) entries.delete(k);
  }
  return { ok: true };
}

// -------- watch entry CRUD --------

export async function listWatchEntries(
  userId: string,
  listId?: string,
): Promise<WatchEntry[]> {
  await ensureListsDDL();
  // Guarantee default exists (so legacy rows get list_id back-filled).
  const defaultList = await ensureDefaultList(userId);
  const targetListId = listId ?? defaultList.id;

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        SELECT ticker, name, sector, source, memo, memo_provider, created_at, list_id
        FROM user_watchlist
        WHERE user_id = ${userId} AND list_id = ${targetListId}
        ORDER BY created_at DESC
      `) as Array<Parameters<typeof rowToEntry>[0]>;
      const items = rows.map(rowToEntry);
      // Keep memory warm for same-process reads.
      const m = memBucket(userId);
      // Only refresh the slice for this list to avoid nuking other lists.
      for (const [k, v] of m) {
        if (v.listId === targetListId) m.delete(k);
      }
      for (const e of items) m.set(e.ticker, e);
      return items;
    }
  }

  return [...memBucket(userId).values()]
    .filter((e) => (e.listId ?? defaultList.id) === targetListId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function upsertWatchEntry(
  userId: string,
  entry: Omit<WatchEntry, "createdAt"> & { createdAt?: string },
): Promise<WatchEntry> {
  await ensureListsDDL();
  const defaultList = await ensureDefaultList(userId);
  const listId = entry.listId ?? defaultList.id;

  const ticker = entry.ticker.trim().toUpperCase();
  const existingMem = memBucket(userId).get(ticker);
  const createdAt = existingMem?.createdAt ?? entry.createdAt ?? new Date().toISOString();
  const next: WatchEntry = {
    ticker,
    name: entry.name ?? existingMem?.name,
    sector: entry.sector ?? existingMem?.sector,
    source: entry.source ?? existingMem?.source ?? "manual",
    memo: entry.memo ?? existingMem?.memo,
    memoProvider: entry.memoProvider ?? existingMem?.memoProvider,
    createdAt,
    listId,
  };
  memBucket(userId).set(ticker, next);

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const created = new Date(createdAt);
      await sql`
        INSERT INTO user_watchlist (
          user_id, ticker, name, sector, source, memo, memo_provider, created_at, updated_at, list_id
        ) VALUES (
          ${userId},
          ${ticker},
          ${next.name ?? null},
          ${next.sector ?? null},
          ${next.source},
          ${next.memo ?? null},
          ${next.memoProvider ?? null},
          ${created},
          now(),
          ${listId}
        )
        ON CONFLICT (user_id, ticker) DO UPDATE SET
          name = COALESCE(EXCLUDED.name, user_watchlist.name),
          sector = COALESCE(EXCLUDED.sector, user_watchlist.sector),
          source = EXCLUDED.source,
          memo = COALESCE(EXCLUDED.memo, user_watchlist.memo),
          memo_provider = COALESCE(EXCLUDED.memo_provider, user_watchlist.memo_provider),
          list_id = COALESCE(EXCLUDED.list_id, user_watchlist.list_id),
          updated_at = now()
      `;
    }
  }
  return next;
}

export async function removeWatchEntry(userId: string, ticker: string): Promise<boolean> {
  await ensureListsDDL();
  const sym = ticker.trim().toUpperCase();
  const removedMem = memBucket(userId).delete(sym);
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = await sql`
        DELETE FROM user_watchlist
        WHERE user_id = ${userId} AND ticker = ${sym}
        RETURNING ticker
      `;
      return (rows as unknown[]).length > 0 || removedMem;
    }
  }
  return removedMem;
}

/**
 * Moves a ticker between lists. Returns the updated entry, or null when the
 * ticker isn't currently on any of the user's lists.
 */
export async function moveWatchEntry(
  userId: string,
  ticker: string,
  toListId: string,
): Promise<WatchEntry | null> {
  await ensureListsDDL();
  const sym = ticker.trim().toUpperCase();

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        UPDATE user_watchlist
        SET list_id = ${toListId}, updated_at = now()
        WHERE user_id = ${userId} AND ticker = ${sym}
        RETURNING ticker, name, sector, source, memo, memo_provider, created_at, list_id
      `) as Array<Parameters<typeof rowToEntry>[0]>;
      if (rows.length === 0) return null;
      const entry = rowToEntry(rows[0]!);
      memBucket(userId).set(sym, entry);
      return entry;
    }
  }

  const bucket = memBucket(userId);
  const existing = bucket.get(sym);
  if (!existing) return null;
  const updated: WatchEntry = { ...existing, listId: toListId };
  bucket.set(sym, updated);
  return updated;
}

export async function attachWatchMemo(
  userId: string,
  ticker: string,
  memo: string,
  provider?: string,
): Promise<WatchEntry | null> {
  await ensureListsDDL();
  const sym = ticker.trim().toUpperCase();
  // Read across the user's full watchlist (any list) so /memo attaches to
  // whatever list the ticker currently lives in.
  const bucket = memBucket(userId);
  let existing = bucket.get(sym);
  if (!existing && dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        SELECT ticker, name, sector, source, memo, memo_provider, created_at, list_id
        FROM user_watchlist
        WHERE user_id = ${userId} AND ticker = ${sym}
        LIMIT 1
      `) as Array<Parameters<typeof rowToEntry>[0]>;
      if (rows.length > 0) existing = rowToEntry(rows[0]!);
    }
  }
  if (!existing) return null;
  return upsertWatchEntry(userId, {
    ...existing,
    memo,
    memoProvider: provider,
    source: existing.source,
  });
}
