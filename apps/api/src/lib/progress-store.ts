/**
 * Server-side progression — XP, level, streak, streak-freeze inventory
 * (Universe Roadmap §1 A1).
 *
 * The streak is server truth: it is written by `recordFind` on every
 * successful /v1/identify and read back by `GET /v1/progress`, so it survives
 * a reinstall and cannot be forged by a client clock.
 *
 * Postgres when POSTGRES_URL is set (Railway); in-memory fallback for local
 * tests. Follows `finds-store.ts` — the table is created lazily via
 * `CREATE TABLE IF NOT EXISTS` the first time the store is touched (no
 * migrations runner, matching the rest of the codebase).
 *
 * Table:
 *   user_progress(
 *     user_id text PK, xp int, level int,
 *     streak_days int, streak_freezes int,
 *     last_find_day text,               -- YYYY-MM-DD (UTC)
 *     updated_at timestamptz default now()
 *   )
 */
import type { UserProgress } from "@mapvest/core";
import { dbEnabled, getSql, initDb } from "./db.js";

/** XP awarded per recorded find. */
export const XP_PER_FIND = 10;

/**
 * Streak lengths that grant streak freezes the moment the streak *becomes*
 * that long, and how many freezes each grants.
 */
export const FREEZE_MILESTONES: ReadonlyArray<{ streak: number; freezes: number }> = [
  { streak: 7, freezes: 1 },
  { streak: 30, freezes: 2 },
  { streak: 100, freezes: 3 },
];

const MS_PER_DAY = 86_400_000;

// userId -> progress row (fallback when POSTGRES_URL is unset).
const memory = new Map<string, UserProgress>();

/** The zero row for a user who has never recorded a find. */
export function defaultProgress(): UserProgress {
  return {
    xp: 0,
    level: 1,
    streakDays: 0,
    streakFreezes: 0,
    lastFindDay: undefined,
    updatedAt: new Date(0).toISOString(),
  };
}

/** UTC calendar day (`YYYY-MM-DD`) for an ISO timestamp. */
export function utcDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/** Whole days between two `YYYY-MM-DD` UTC day strings (`b - a`). */
export function dayDiff(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00.000Z`);
  const tb = Date.parse(`${b}T00:00:00.000Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.round((tb - ta) / MS_PER_DAY);
}

/** Level curve: 0 xp → 1, 100 xp → 2, 400 → 3, 900 → 4 … */
export function levelForXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(xp, 0) / 100)) + 1;
}

/**
 * Pure progression rule — given the current row and the UTC day of a new find,
 * return the next row. Kept free of I/O so it is directly unit-testable.
 *
 * - +10 XP per find, always; level is derived from total XP.
 * - Same UTC day as `lastFindDay` → streak unchanged.
 * - `lastFindDay` was yesterday → streak + 1.
 * - Exactly one missed day and a freeze in inventory → spend one freeze,
 *   streak + 1 (the gap is papered over).
 * - Anything else (first find ever, or a longer/unfrozen gap) → streak resets
 *   to 1.
 * - A streak that *becomes* 7/30/100 grants 1/2/3 freezes. A streak that was
 *   already at the milestone (same-day find) grants nothing, so freezes cannot
 *   be farmed by repeat finds.
 *
 * A find dated *before* `lastFindDay` (clock skew, replayed backlog) still
 * earns XP but leaves the streak and `lastFindDay` untouched rather than
 * resetting a legitimate streak.
 */
export function applyFind(progress: UserProgress, dayUtc: string): UserProgress {
  const xp = progress.xp + XP_PER_FIND;
  const nowIso = new Date().toISOString();
  const base: UserProgress = {
    ...progress,
    xp,
    level: levelForXp(xp),
    updatedAt: nowIso,
  };

  const last = progress.lastFindDay;
  if (!last) {
    return { ...base, streakDays: 1, lastFindDay: dayUtc };
  }

  const diff = dayDiff(last, dayUtc);

  // Same day, or an out-of-order/backdated find: XP only.
  if (diff <= 0) return base;

  let streakDays: number;
  let streakFreezes = progress.streakFreezes;
  if (diff === 1) {
    streakDays = progress.streakDays + 1;
  } else if (diff === 2 && progress.streakFreezes > 0) {
    streakFreezes -= 1;
    streakDays = progress.streakDays + 1;
  } else {
    streakDays = 1;
  }

  const milestone = FREEZE_MILESTONES.find((m) => m.streak === streakDays);
  if (milestone) streakFreezes += milestone.freezes;

  return { ...base, streakDays, streakFreezes, lastFindDay: dayUtc };
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
    CREATE TABLE IF NOT EXISTS user_progress (
      user_id TEXT PRIMARY KEY,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      streak_days INTEGER NOT NULL DEFAULT 0,
      streak_freezes INTEGER NOT NULL DEFAULT 0,
      last_find_day TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  tableEnsured = true;
}

function rowToProgress(row: {
  xp: number;
  level: number;
  streak_days: number;
  streak_freezes: number;
  last_find_day: string | null;
  updated_at: Date | string;
}): UserProgress {
  const updatedAt =
    typeof row.updated_at === "string" ? row.updated_at : row.updated_at.toISOString();
  return {
    xp: Number(row.xp),
    level: Number(row.level),
    streakDays: Number(row.streak_days),
    streakFreezes: Number(row.streak_freezes),
    lastFindDay: row.last_find_day ?? undefined,
    updatedAt,
  };
}

/** Current progression for a user, or the zero row if they have none yet. */
export async function getProgress(userId: string): Promise<UserProgress> {
  await ensureTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = await sql`
        SELECT xp, level, streak_days, streak_freezes, last_find_day, updated_at
        FROM user_progress
        WHERE user_id = ${userId}
        LIMIT 1
      `;
      const row = (rows as Array<Parameters<typeof rowToProgress>[0]>)[0];
      return row ? rowToProgress(row) : defaultProgress();
    }
  }
  return memory.get(userId) ?? defaultProgress();
}

async function persist(userId: string, next: UserProgress): Promise<void> {
  // Memory is the store only when Postgres is off; mirroring every write when
  // the DB is on would grow one never-read entry per user for the process
  // lifetime (finds-store bounds its fallback with MEMORY_CAP for the same reason).
  if (!dbEnabled()) {
    memory.set(userId, next);
    return;
  }
  const sql = getSql();
  if (!sql) return;
  await sql`
    INSERT INTO user_progress (
      user_id, xp, level, streak_days, streak_freezes, last_find_day, updated_at
    ) VALUES (
      ${userId},
      ${next.xp},
      ${next.level},
      ${next.streakDays},
      ${next.streakFreezes},
      ${next.lastFindDay ?? null},
      ${new Date(next.updatedAt)}
    )
    ON CONFLICT (user_id) DO UPDATE SET
      xp = EXCLUDED.xp,
      level = EXCLUDED.level,
      streak_days = EXCLUDED.streak_days,
      streak_freezes = EXCLUDED.streak_freezes,
      last_find_day = EXCLUDED.last_find_day,
      updated_at = EXCLUDED.updated_at
  `;
}

/**
 * Award a find: load-or-default the row, apply the pure rule for the find's
 * UTC day, persist. Called fire-and-forget from `recordFind` — a progression
 * write must never fail an identify.
 */
export async function bumpProgressOnFind(userId: string, createdAtIso: string): Promise<void> {
  const current = await getProgress(userId);
  const next = applyFind(current, utcDay(createdAtIso));
  await persist(userId, next);
}
