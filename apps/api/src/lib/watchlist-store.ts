/**
 * Per-user watchlist persistence.
 * Postgres when POSTGRES_URL is set; otherwise in-memory (tests / local).
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
};

const memory = new Map<string, Map<string, WatchEntry>>();

function memBucket(userId: string): Map<string, WatchEntry> {
  let m = memory.get(userId);
  if (!m) {
    m = new Map();
    memory.set(userId, m);
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
  };
}

export async function listWatchEntries(userId: string): Promise<WatchEntry[]> {
  await initDb();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = await sql`
        SELECT ticker, name, sector, source, memo, memo_provider, created_at
        FROM user_watchlist
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `;
      const items = (rows as Array<Parameters<typeof rowToEntry>[0]>).map(rowToEntry);
      // Keep memory warm for same-process reads.
      const m = memBucket(userId);
      m.clear();
      for (const e of items) m.set(e.ticker, e);
      return items;
    }
  }
  return [...memBucket(userId).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function upsertWatchEntry(
  userId: string,
  entry: Omit<WatchEntry, "createdAt"> & { createdAt?: string },
): Promise<WatchEntry> {
  await initDb();
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
  };
  memBucket(userId).set(ticker, next);

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const created = new Date(createdAt);
      await sql`
        INSERT INTO user_watchlist (
          user_id, ticker, name, sector, source, memo, memo_provider, created_at, updated_at
        ) VALUES (
          ${userId},
          ${ticker},
          ${next.name ?? null},
          ${next.sector ?? null},
          ${next.source},
          ${next.memo ?? null},
          ${next.memoProvider ?? null},
          ${created},
          now()
        )
        ON CONFLICT (user_id, ticker) DO UPDATE SET
          name = COALESCE(EXCLUDED.name, user_watchlist.name),
          sector = COALESCE(EXCLUDED.sector, user_watchlist.sector),
          source = EXCLUDED.source,
          memo = COALESCE(EXCLUDED.memo, user_watchlist.memo),
          memo_provider = COALESCE(EXCLUDED.memo_provider, user_watchlist.memo_provider),
          updated_at = now()
      `;
    }
  }
  return next;
}

export async function removeWatchEntry(userId: string, ticker: string): Promise<boolean> {
  await initDb();
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

export async function attachWatchMemo(
  userId: string,
  ticker: string,
  memo: string,
  provider?: string,
): Promise<WatchEntry | null> {
  await initDb();
  const sym = ticker.trim().toUpperCase();
  const items = await listWatchEntries(userId);
  const existing = items.find((e) => e.ticker === sym);
  if (!existing) return null;
  return upsertWatchEntry(userId, {
    ...existing,
    memo,
    memoProvider: provider,
    source: existing.source,
  });
}
