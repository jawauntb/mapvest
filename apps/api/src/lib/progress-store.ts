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
 * Tables:
 *   user_progress(
 *     user_id text PK, xp int, level int,
 *     streak_days int, streak_freezes int,
 *     last_find_day text,               -- YYYY-MM-DD (UTC)
 *     badges jsonb default '[]',        -- earned badge keys
 *     updated_at timestamptz default now()
 *   )
 *   user_xp_grants(
 *     user_id text, grant_key text, xp int,
 *     created_at timestamptz default now(),
 *     PRIMARY KEY (user_id, grant_key)
 *   )
 *
 * `user_xp_grants` is the idempotency ledger behind `awardXp` / `awardBadge`
 * (Universe Roadmap §1 A4/A5). Every XP award that is not "one per find" —
 * quest completions, sector-completion badges — names a stable `grantKey` and
 * is written at most once, so a route that recomputes derived state on every
 * read (quests, dex) can call the award unconditionally and stay free after
 * the first time.
 */
import type { UserProgress } from "@mapvest/core";
import { canonicalSector, normalizeBrand, seedBrands } from "@mapvest/finance";
import { dbEnabled, getSql, initDb } from "./db.js";
import { activeEvent, multiplierForSector } from "./events.js";

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
// userId -> claimed grant keys (fallback when POSTGRES_URL is unset). This is
// the memory twin of `user_xp_grants`' primary key.
const memoryGrants = new Map<string, Set<string>>();

/** The zero row for a user who has never recorded a find. */
export function defaultProgress(): UserProgress {
  return {
    xp: 0,
    level: 1,
    streakDays: 0,
    streakFreezes: 0,
    lastFindDay: undefined,
    badges: [],
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

/**
 * Pure XP-grant rule — add `xp` to a row, re-derive the level, and optionally
 * append a badge key. Kept free of I/O so the arithmetic is unit-testable and
 * shared by both the Postgres and memory paths.
 *
 * XP is clamped at 0: a caller passing a negative amount can claim its grant
 * key (so the ledger still records that the award happened) but can never
 * subtract from a user's total. Badge keys are set-appended, so a badge that
 * somehow lands twice does not duplicate in the array.
 */
export function applyXpGrant(progress: UserProgress, xp: number, badge?: string): UserProgress {
  const gained = Math.max(0, Math.trunc(xp));
  const total = progress.xp + gained;
  const badges =
    badge && !progress.badges.includes(badge) ? [...progress.badges, badge] : progress.badges;
  return {
    ...progress,
    xp: total,
    level: levelForXp(total),
    badges,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * What a find needs to carry for the event system to know which sector it is
 * in. Deliberately structural (not `Find`) so `recordFind` can pass its input
 * before the row exists and tests can pass a literal.
 */
export type FindXpContext = {
  brand?: string;
  ticker?: string;
  comparable?: string;
};

/** Structural shape of the brand seed, so tests can inject a two-line literal. */
export type XpSeedEntry = { ticker: string; sector?: string };
export type XpSeed = Record<string, XpSeedEntry>;

/** Lazily-built ticker -> canonical sector index over the production seed. */
let seedTickerSectorCache: Map<string, string> | null = null;

function tickerSectorIndex(seed: XpSeed): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of Object.values(seed)) {
    const ticker = entry.ticker?.trim().toUpperCase();
    if (!ticker || index.has(ticker)) continue;
    const sector = canonicalSector(entry.sector);
    if (sector) index.set(ticker, sector);
  }
  return index;
}

/**
 * Best-effort canonical GICS sector for a find: the seed entry for its brand
 * name first (the seed is keyed by normalized brand), else the seed's sector
 * for its effective ticker (ticker, else the public comparable of a private
 * brand). Returns null when the seed does not know — an unknown sector never
 * multiplies, it just earns the base rate, and never throws.
 */
export function seedSectorForFind(ctx: FindXpContext, seed: XpSeed = seedBrands): string | null {
  try {
    const brand = ctx.brand?.trim();
    if (brand) {
      const entry = seed[normalizeBrand(brand)];
      const sector = canonicalSector(entry?.sector);
      if (sector) return sector;
    }
    const symbol = (ctx.ticker ?? ctx.comparable ?? "").trim().toUpperCase();
    if (!symbol) return null;
    // The production seed is ~1100 entries and never changes at runtime, so
    // its ticker index is built once; an injected seed (tests) is not cached.
    if (seed !== seedBrands) return tickerSectorIndex(seed).get(symbol) ?? null;
    if (!seedTickerSectorCache) seedTickerSectorCache = tickerSectorIndex(seed);
    return seedTickerSectorCache.get(symbol) ?? null;
  } catch {
    return null;
  }
}

/**
 * Call-site composition of the per-find XP rule and an event multiplier.
 * `applyFind` stays pure and multiplier-free (it is the streak rule, and the
 * streak is not affected by events); the bonus rides in as a second, ordinary
 * XP grant of `XP_PER_FIND * (multiplier - 1)`, so the totals arithmetic and
 * the level curve stay in one place.
 *
 * A multiplier of 1 (or less, or non-finite) is exactly `applyFind`.
 */
export function applyFindWithMultiplier(
  progress: UserProgress,
  dayUtc: string,
  multiplier: number,
): UserProgress {
  const base = applyFind(progress, dayUtc);
  if (!Number.isFinite(multiplier) || multiplier <= 1) return base;
  const bonus = Math.trunc(XP_PER_FIND * multiplier) - XP_PER_FIND;
  if (bonus <= 0) return base;
  return applyXpGrant(base, bonus);
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
      badges JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // A1 shipped this table without `badges`; add it in place rather than
  // through a migrations runner (same posture as db.ts's users columns).
  await sql`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS badges JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`
    CREATE TABLE IF NOT EXISTS user_xp_grants (
      user_id TEXT NOT NULL,
      grant_key TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, grant_key)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS user_xp_grants_user_idx
      ON user_xp_grants (user_id, created_at DESC)
  `;
  tableEnsured = true;
}

/** JSONB comes back parsed by Bun's driver, but tolerate a raw string too. */
function parseBadges(raw: unknown): string[] {
  const value = typeof raw === "string" ? safeJsonParse(raw) : raw;
  if (!Array.isArray(value)) return [];
  return value.filter((b): b is string => typeof b === "string");
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rowToProgress(row: {
  xp: number;
  level: number;
  streak_days: number;
  streak_freezes: number;
  last_find_day: string | null;
  badges?: unknown;
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
    badges: parseBadges(row.badges),
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
        SELECT xp, level, streak_days, streak_freezes, last_find_day, badges, updated_at
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
      user_id, xp, level, streak_days, streak_freezes, last_find_day, badges, updated_at
    ) VALUES (
      ${userId},
      ${next.xp},
      ${next.level},
      ${next.streakDays},
      ${next.streakFreezes},
      ${next.lastFindDay ?? null},
      ${JSON.stringify(next.badges)}::jsonb,
      ${new Date(next.updatedAt)}
    )
    ON CONFLICT (user_id) DO UPDATE SET
      xp = EXCLUDED.xp,
      level = EXCLUDED.level,
      streak_days = EXCLUDED.streak_days,
      streak_freezes = EXCLUDED.streak_freezes,
      last_find_day = EXCLUDED.last_find_day,
      badges = EXCLUDED.badges,
      updated_at = EXCLUDED.updated_at
  `;
}

/**
 * Claim a grant key exactly once. Returns true only for the caller that
 * actually wrote the ledger row — `INSERT … ON CONFLICT DO NOTHING RETURNING`
 * yields zero rows when the key was already taken, and the memory path is the
 * same check against a per-user Set.
 */
async function claimGrant(userId: string, grantKey: string, xp: number): Promise<boolean> {
  await ensureTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = await sql`
        INSERT INTO user_xp_grants (user_id, grant_key, xp)
        VALUES (${userId}, ${grantKey}, ${Math.max(0, Math.trunc(xp))})
        ON CONFLICT (user_id, grant_key) DO NOTHING
        RETURNING grant_key
      `;
      return (rows as unknown[]).length > 0;
    }
  }
  let claimed = memoryGrants.get(userId);
  if (!claimed) {
    claimed = new Set<string>();
    memoryGrants.set(userId, claimed);
  }
  if (claimed.has(grantKey)) return false;
  claimed.add(grantKey);
  return true;
}

/**
 * Apply a claimed grant to the Postgres row ATOMICALLY — a targeted increment,
 * never a read-modify-write full-row upsert. Concurrent grant/streak writers
 * (the quests, dex and progress fetches all fire in parallel from the client)
 * therefore cannot clobber each other's xp, badges or streak columns: each
 * grant adds its own delta, the level is re-derived in SQL from the same
 * expression `levelForXp` uses, and a badge is set-appended only when absent.
 * Returns false when Postgres is not the active backend.
 */
async function applyGrantAtomic(userId: string, xp: number, badge?: string): Promise<boolean> {
  if (!dbEnabled()) return false;
  const sql = getSql();
  if (!sql) return false;
  const gained = Math.max(0, Math.trunc(xp));
  const badgeJson = badge ? JSON.stringify([badge]) : null;
  // Ensure the row exists without touching an existing one…
  await sql`
    INSERT INTO user_progress (
      user_id, xp, level, streak_days, streak_freezes, last_find_day, badges, updated_at
    ) VALUES (${userId}, 0, 1, 0, 0, NULL, '[]'::jsonb, now())
    ON CONFLICT (user_id) DO NOTHING
  `;
  // …then increment in place. `xp` on the right-hand side is the row's current
  // value at UPDATE time, so parallel grants serialize on the row lock and
  // both deltas land.
  await sql`
    UPDATE user_progress SET
      xp = xp + ${gained},
      level = FLOOR(SQRT(GREATEST(xp + ${gained}, 0) / 100.0)) + 1,
      badges = CASE
        WHEN ${badgeJson}::jsonb IS NULL THEN badges
        WHEN badges @> ${badgeJson}::jsonb THEN badges
        ELSE badges || ${badgeJson}::jsonb
      END,
      updated_at = now()
    WHERE user_id = ${userId}
  `;
  return true;
}

/**
 * Idempotent XP award. `grantKey` is the identity of the award, not of the
 * user action: `"quest:2026-08-20:catch_any"`, `"badge:sector:Energy"`.
 * Returns true on the first grant (XP added, level re-derived), false forever
 * after — so a route that recomputes derived state on every read can call this
 * unconditionally and the second read is free.
 *
 * On Postgres the grant is applied as an atomic in-place increment (see
 * `applyGrantAtomic`); the pure `applyXpGrant` read-modify-write is used only
 * by the single-threaded memory fallback.
 */
export async function awardXp(userId: string, xp: number, grantKey: string): Promise<boolean> {
  if (!(await claimGrant(userId, grantKey, xp))) return false;
  if (await applyGrantAtomic(userId, xp)) return true;
  const current = await getProgress(userId);
  await persist(userId, applyXpGrant(current, xp));
  return true;
}

/**
 * Idempotent badge award: `awardXp` under the grant key `"badge:{badge}"`,
 * plus a one-time append of the badge key to the progress row's `badges`.
 * Badge keys are opaque strings (`"sector:Consumer Staples"`) so a new badge
 * family ships without a schema change.
 */
export async function awardBadge(userId: string, badge: string, xp: number): Promise<boolean> {
  const grantKey = `badge:${badge}`;
  if (!(await claimGrant(userId, grantKey, xp))) return false;
  if (await applyGrantAtomic(userId, xp, badge)) return true;
  const current = await getProgress(userId);
  await persist(userId, applyXpGrant(current, xp, badge));
  return true;
}

/**
 * Award a find: load-or-default the row, apply the pure rule for the find's
 * UTC day, persist. Called fire-and-forget from `recordFind` — a progression
 * write must never fail an identify.
 *
 * `context` is optional and only affects XP: when an event is open right now
 * (`lib/events.ts` — Sector Saturday) and the find's seed sector matches the
 * event's, the find earns `XP_PER_FIND * multiplier` instead of `XP_PER_FIND`.
 * The sector lookup is best-effort and silent: a brand the seed does not know
 * simply earns the base rate. The multiplier is decided here, at the call
 * site, so `applyFind` stays the pure streak rule (Universe Roadmap §1 A7).
 */
export async function bumpProgressOnFind(
  userId: string,
  createdAtIso: string,
  context?: FindXpContext,
): Promise<void> {
  const current = await getProgress(userId);
  let multiplier = 1;
  if (context) {
    const event = activeEvent(new Date());
    if (event) multiplier = multiplierForSector(seedSectorForFind(context), event);
  }
  const next = applyFindWithMultiplier(current, utcDay(createdAtIso), multiplier);
  await persist(userId, next);
}
