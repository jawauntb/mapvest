/**
 * Rivalries — solo weekly matchups (Universe Roadmap §3 C6).
 *
 * A rivalry pits one of the user's finds against a comparable (NVDA vs AMD)
 * as a tracked weekly round. This is single-player: there is no opponent
 * user, no social graph, no position. PvP is explicitly rejected by the
 * roadmap. The only outcome is a running wins/losses/draws record, and the
 * optional `currentPick` is a pre-registered guess that earns XP — a
 * comprehension mechanic, never advice.
 *
 * Postgres when POSTGRES_URL is set (Railway); in-memory fallback for local
 * tests. Same lazy-DDL posture as `finds-store.ts` — the first touch runs
 * `CREATE TABLE IF NOT EXISTS` and short-circuits thereafter (no migrations
 * runner anywhere in this codebase).
 *
 * Table:
 *   user_rivalries(
 *     id UUID PK,
 *     user_id TEXT, ticker TEXT, rival_ticker TEXT,
 *     wins INT, losses INT, draws INT,
 *     current_pick TEXT,                 -- 'ticker' | 'rival' | NULL
 *     week_start TEXT,                   -- YYYY-MM-DD, Monday, UTC
 *     created_at TIMESTAMPTZ,
 *     UNIQUE(user_id, ticker, rival_ticker)
 *   )
 *
 * Only tickers are stored. When the client omits `rivalTicker` the route
 * resolves the opponent through the existing comparables pipeline and cites
 * that resolution on its span; the citation belongs to the resolution, not to
 * this row, so no `sources` column exists here (AGENTS.md §6 — never fabricate
 * a citation, and never restate one you did not fetch).
 *
 * `week_start` is the Monday of the CURRENT open round as a UTC calendar day,
 * so the round boundary does not move with the device timezone.
 */
import type { Rivalry } from "@mapvest/core";
import { dbEnabled, getSql, initDb } from "./db.js";

/** Which side of the matchup a pre-registered pick backs. */
export type RivalryPick = NonNullable<Rivalry["currentPick"]>;

/** Outcome of one closed round, from the user's `ticker` side. */
export type RivalryOutcome = "win" | "loss" | "draw";

/** A stored row: the wire `Rivalry` plus its owner (never sent to clients). */
export type StoredRivalry = Rivalry & { userId: string };

/** Product cap — a rivalry is a weekly commitment, not a watchlist. */
export const MAX_RIVALRIES_PER_USER = 10;

export type CreateRivalryResult =
  | { ok: true; rivalry: Rivalry }
  | { ok: false; reason: "duplicate" | "cap" | "same_ticker"; rivalry?: Rivalry };

// id -> row, plus a per-user index (mirrors push-tokens-store).
const memory = new Map<string, StoredRivalry>();
const memoryByUser = new Map<string, Set<string>>();

function memBucket(userId: string): Set<string> {
  let ids = memoryByUser.get(userId);
  if (!ids) {
    ids = new Set();
    memoryByUser.set(userId, ids);
  }
  return ids;
}

/** Uppercase, trimmed symbol. Empty string when there is nothing usable. */
export function normalizeSymbol(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

/**
 * The Monday (UTC) of the week containing `now`, as `YYYY-MM-DD`. Pure.
 * Rounds open and close on this boundary so a user in UTC+13 and a user in
 * UTC-8 are always scored over the same five sessions.
 */
export function mondayUtc(now: Date = new Date()): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  // getUTCDay(): 0=Sun … 6=Sat. Monday-anchored offset.
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/**
 * The Monday AFTER `now`'s week — what `weekStart` becomes when a round
 * closes, so the field always names the round that is now open rather than
 * going a week stale between the Saturday close and the next Monday.
 */
export function nextMondayUtc(now: Date = new Date()): string {
  const monday = new Date(`${mondayUtc(now)}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() + 7);
  return monday.toISOString().slice(0, 10);
}

/** Wire projection — drops the owner id. */
export function toWire(row: StoredRivalry): Rivalry {
  return {
    id: row.id,
    ticker: row.ticker,
    rivalTicker: row.rivalTicker,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    ...(row.currentPick ? { currentPick: row.currentPick } : {}),
    weekStart: row.weekStart,
    createdAt: row.createdAt,
  };
}

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await initDb();
  if (!dbEnabled()) {
    tableReady = true;
    return;
  }
  const sql = getSql();
  if (!sql) {
    tableReady = true;
    return;
  }
  await sql`
    CREATE TABLE IF NOT EXISTS user_rivalries (
      id UUID PRIMARY KEY,
      user_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      rival_ticker TEXT NOT NULL,
      wins INT NOT NULL DEFAULT 0,
      losses INT NOT NULL DEFAULT 0,
      draws INT NOT NULL DEFAULT 0,
      current_pick TEXT,
      week_start TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, ticker, rival_ticker)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS user_rivalries_user_idx
      ON user_rivalries (user_id, created_at DESC)
  `;
  tableReady = true;
}

type Row = {
  id: string;
  user_id: string;
  ticker: string;
  rival_ticker: string;
  wins: number;
  losses: number;
  draws: number;
  current_pick: string | null;
  week_start: string;
  created_at: Date | string;
};

function rowToRivalry(row: Row): StoredRivalry {
  const createdAt =
    typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString();
  const pick =
    row.current_pick === "ticker" || row.current_pick === "rival" ? row.current_pick : undefined;
  return {
    id: row.id,
    userId: row.user_id,
    ticker: row.ticker,
    rivalTicker: row.rival_ticker,
    wins: Number(row.wins) || 0,
    losses: Number(row.losses) || 0,
    draws: Number(row.draws) || 0,
    ...(pick ? { currentPick: pick } : {}),
    weekStart: row.week_start,
    createdAt,
  };
}

function cacheRow(row: StoredRivalry): StoredRivalry {
  memory.set(row.id, row);
  memBucket(row.userId).add(row.id);
  return row;
}

function memRowsForUser(userId: string): StoredRivalry[] {
  return [...memBucket(userId)]
    .map((id) => memory.get(id))
    .filter((r): r is StoredRivalry => Boolean(r))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Create a matchup. Idempotent on `(userId, ticker, rivalTicker)`: an existing
 * pair is returned as `{ ok: false, reason: "duplicate", rivalry }` so the
 * route can 409 without the caller losing the id it already owns.
 *
 * Ticker plausibility is the ROUTE's job (`isPlausibleTicker` from
 * `@mapvest/finance`) — the store only refuses a self-matchup, which no
 * plausibility check would catch.
 */
export async function createRivalry(
  userId: string,
  input: { ticker: string; rivalTicker: string; currentPick?: RivalryPick },
  now: Date = new Date(),
): Promise<CreateRivalryResult> {
  await ensureTable();
  const ticker = normalizeSymbol(input.ticker);
  const rivalTicker = normalizeSymbol(input.rivalTicker);
  if (ticker === rivalTicker) return { ok: false, reason: "same_ticker" };

  const existing = await listRivalries(userId);
  const dupe = existing.find((r) => r.ticker === ticker && r.rivalTicker === rivalTicker);
  if (dupe) return { ok: false, reason: "duplicate", rivalry: dupe };
  if (existing.length >= MAX_RIVALRIES_PER_USER) return { ok: false, reason: "cap" };

  const row: StoredRivalry = {
    id: crypto.randomUUID(),
    userId,
    ticker,
    rivalTicker,
    wins: 0,
    losses: 0,
    draws: 0,
    ...(input.currentPick ? { currentPick: input.currentPick } : {}),
    weekStart: mondayUtc(now),
    createdAt: now.toISOString(),
  };

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const inserted = (await sql`
        INSERT INTO user_rivalries (
          id, user_id, ticker, rival_ticker, wins, losses, draws,
          current_pick, week_start, created_at
        ) VALUES (
          ${row.id}, ${userId}, ${row.ticker}, ${row.rivalTicker}, 0, 0, 0,
          ${row.currentPick ?? null}, ${row.weekStart}, ${now}
        )
        ON CONFLICT (user_id, ticker, rival_ticker) DO NOTHING
        RETURNING id, user_id, ticker, rival_ticker, wins, losses, draws,
               current_pick, week_start, created_at
      `) as Row[];
      if (inserted.length === 0) {
        // Lost a race against a concurrent create — return the winner's row.
        const rows = (await sql`
          SELECT id, user_id, ticker, rival_ticker, wins, losses, draws,
               current_pick, week_start, created_at FROM user_rivalries
          WHERE user_id = ${userId} AND ticker = ${row.ticker}
            AND rival_ticker = ${row.rivalTicker}
          LIMIT 1
        `) as Row[];
        const winner = rows[0] ? cacheRow(rowToRivalry(rows[0])) : undefined;
        return { ok: false, reason: "duplicate", ...(winner ? { rivalry: toWire(winner) } : {}) };
      }
      return { ok: true, rivalry: toWire(cacheRow(rowToRivalry(inserted[0] as Row))) };
    }
  }

  cacheRow(row);
  return { ok: true, rivalry: toWire(row) };
}

/** Every rivalry the user owns, newest first. */
export async function listRivalries(userId: string): Promise<Rivalry[]> {
  await ensureTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        SELECT id, user_id, ticker, rival_ticker, wins, losses, draws,
               current_pick, week_start, created_at FROM user_rivalries
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `) as Row[];
      const bucket = memBucket(userId);
      bucket.clear();
      return rows.map((r) => toWire(cacheRow(rowToRivalry(r))));
    }
  }
  return memRowsForUser(userId).map(toWire);
}

/** One rivalry by id, scoped to its owner. `null` when it isn't theirs. */
export async function getRivalry(userId: string, id: string): Promise<Rivalry | null> {
  await ensureTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        SELECT id, user_id, ticker, rival_ticker, wins, losses, draws,
               current_pick, week_start, created_at FROM user_rivalries
        WHERE id = ${id} AND user_id = ${userId} LIMIT 1
      `) as Row[];
      return rows[0] ? toWire(cacheRow(rowToRivalry(rows[0]))) : null;
    }
  }
  const row = memory.get(id);
  return row && row.userId === userId ? toWire(row) : null;
}

/**
 * Pre-register (or clear) the pick for the OPEN round. Scoped to the owner —
 * `null` when the id isn't theirs. Picks are not retroactive: the weekly close
 * reads whatever pick stands at close time and then clears it.
 */
export async function setPick(
  userId: string,
  id: string,
  pick: RivalryPick | null,
): Promise<Rivalry | null> {
  await ensureTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        UPDATE user_rivalries
        SET current_pick = ${pick}
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING id, user_id, ticker, rival_ticker, wins, losses, draws,
               current_pick, week_start, created_at
      `) as Row[];
      return rows[0] ? toWire(cacheRow(rowToRivalry(rows[0]))) : null;
    }
  }
  const row = memory.get(id);
  if (!row || row.userId !== userId) return null;
  if (pick) row.currentPick = pick;
  else row.currentPick = undefined;
  return toWire(row);
}

/**
 * Close a round: increment the record for `outcome` and open the next round at
 * `newWeekStart`, clearing the pick (a pick is only ever good for the round it
 * was registered in). Not user-scoped — the weekly notifier owns every row.
 *
 * Returns the updated row (with its owner id, which the notifier needs for the
 * XP grant), or `null` when the id is unknown.
 */
export async function recordResult(
  id: string,
  outcome: RivalryOutcome,
  newWeekStart: string,
): Promise<StoredRivalry | null> {
  await ensureTable();
  const winInc = outcome === "win" ? 1 : 0;
  const lossInc = outcome === "loss" ? 1 : 0;
  const drawInc = outcome === "draw" ? 1 : 0;

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        UPDATE user_rivalries
        SET wins = wins + ${winInc},
            losses = losses + ${lossInc},
            draws = draws + ${drawInc},
            current_pick = NULL,
            week_start = ${newWeekStart}
        WHERE id = ${id}
        RETURNING id, user_id, ticker, rival_ticker, wins, losses, draws,
               current_pick, week_start, created_at
      `) as Row[];
      return rows[0] ? cacheRow(rowToRivalry(rows[0])) : null;
    }
  }
  const row = memory.get(id);
  if (!row) return null;
  row.wins += winInc;
  row.losses += lossInc;
  row.draws += drawInc;
  row.currentPick = undefined;
  row.weekStart = newWeekStart;
  return row;
}

/** Delete one rivalry, scoped to its owner. */
export async function deleteRivalry(userId: string, id: string): Promise<boolean> {
  await ensureTable();
  let removed = false;
  const row = memory.get(id);
  if (row && row.userId === userId) {
    memory.delete(id);
    memBucket(userId).delete(id);
    removed = true;
  }
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        DELETE FROM user_rivalries WHERE id = ${id} AND user_id = ${userId} RETURNING id
      `) as unknown[];
      if (rows.length > 0) removed = true;
    }
  }
  return removed;
}

/**
 * Every rivalry across every user, owner id attached. Used only by the weekly
 * close notifier's fan-out — never exposed over HTTP.
 */
export async function listAllRivalries(limit = 5000): Promise<StoredRivalry[]> {
  await ensureTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        SELECT id, user_id, ticker, rival_ticker, wins, losses, draws,
               current_pick, week_start, created_at FROM user_rivalries
        ORDER BY created_at ASC
        LIMIT ${limit}
      `) as Row[];
      return rows.map((r) => cacheRow(rowToRivalry(r)));
    }
  }
  return [...memory.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit);
}

/** Test hook. */
export function _resetRivalriesMemory(): void {
  memory.clear();
  memoryByUser.clear();
  tableReady = false;
}
