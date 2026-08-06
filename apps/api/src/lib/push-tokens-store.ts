/**
 * Per-user push-token persistence.
 *
 * Backs the opt-in push-notifications system. Postgres when POSTGRES_URL is set;
 * in-memory fallback for tests / local dev. Same lazy-DDL pattern as
 * `alerts-store.ts` and `watchlist-store.ts` — first call runs
 * `CREATE TABLE IF NOT EXISTS` and short-circuits thereafter.
 *
 * Schema (Postgres):
 *   push_tokens (
 *     id            text primary key,          -- server-issued opaque id
 *     user_id       text not null,
 *     device_id     text,                       -- from X-Device-Id
 *     expo_token    text not null,              -- ExponentPushToken[…]
 *     platform      text not null default 'ios',
 *     prefs         jsonb not null default '{}',-- { daily_brief: true, ... }
 *     last_seen_at  timestamptz default now(),
 *     created_at    timestamptz default now(),
 *     unique (user_id, expo_token)
 *   )
 *
 * The `prefs` blob carries every per-event opt-in as a boolean AND a small
 * amount of scheduler state (last-known lat/lng, last daily-brief send date).
 * Keeping it JSONB keeps schema churn to zero as new event types land.
 */
import { dbEnabled, getSql, initDb } from "./db.js";

/**
 * Canonical set of push event keys. Client and server must agree on these
 * strings — settings toggles POST them into `prefs`. New events append here.
 */
export const PUSH_EVENT_KEYS = [
  "daily_brief",
  "local_brief",
  "price_alerts",
  "memo_finished",
  "agent_response",
  "identify_done",
  "watchlist_mover",
] as const;

export type PushEventKey = (typeof PUSH_EVENT_KEYS)[number];

export type PushPrefs = Partial<Record<PushEventKey, boolean>> & {
  // Scheduler-tracked location (updated by client heartbeat).
  last_lat?: number;
  last_lng?: number;
  last_location_at?: string; // ISO
  // Per-event last-send bookkeeping (YYYYMMDD or YYYYMMDDHH keys) so a
  // process restart doesn't re-fire pushes the DB already covered.
  last_sent?: Partial<Record<string, string>>;
};

export type PushToken = {
  id: string;
  userId: string;
  deviceId?: string;
  expoToken: string;
  platform: "ios" | "android";
  prefs: PushPrefs;
  lastSeenAt: string;
  createdAt: string;
};

const memory = new Map<string, PushToken>(); // id -> token
const memoryByUser = new Map<string, Set<string>>(); // userId -> token ids

function memBucket(userId: string): Set<string> {
  let s = memoryByUser.get(userId);
  if (!s) {
    s = new Set();
    memoryByUser.set(userId, s);
  }
  return s;
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
    CREATE TABLE IF NOT EXISTS push_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT,
      expo_token TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'ios',
      prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, expo_token)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS push_tokens_user_idx ON push_tokens (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS push_tokens_last_seen_idx ON push_tokens (last_seen_at DESC)`;
  tableReady = true;
}

type Row = {
  id: string;
  user_id: string;
  device_id: string | null;
  expo_token: string;
  platform: string;
  prefs: unknown;
  last_seen_at: Date | string;
  created_at: Date | string;
};

function rowToToken(row: Row): PushToken {
  const lastSeen =
    typeof row.last_seen_at === "string" ? row.last_seen_at : row.last_seen_at.toISOString();
  const created =
    typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString();
  const prefs = (typeof row.prefs === "string"
    ? (() => {
        try {
          return JSON.parse(row.prefs);
        } catch {
          return {};
        }
      })()
    : row.prefs && typeof row.prefs === "object"
      ? (row.prefs as PushPrefs)
      : {}) as PushPrefs;
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id ?? undefined,
    expoToken: row.expo_token,
    platform: row.platform === "android" ? "android" : "ios",
    prefs,
    lastSeenAt: lastSeen,
    createdAt: created,
  };
}

function newId(): string {
  return `push_${crypto.randomUUID().replace(/-/g, "")}`;
}

/**
 * Idempotent register. Same (userId, expoToken) always returns the existing
 * row's id — devices that re-launch after granting perms never accumulate
 * duplicates. `last_seen_at` is bumped on every call so the scheduler can
 * later evict stale tokens if needed.
 */
export async function registerPushToken(
  userId: string,
  expoToken: string,
  platform: "ios" | "android" = "ios",
  deviceId?: string,
): Promise<PushToken> {
  await ensureTable();
  const now = new Date();

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      // Try existing first.
      const existing = (await sql`
        SELECT id, user_id, device_id, expo_token, platform, prefs, last_seen_at, created_at
        FROM push_tokens
        WHERE user_id = ${userId} AND expo_token = ${expoToken}
        LIMIT 1
      `) as Row[];
      if (existing.length > 0) {
        const tok = rowToToken(existing[0]!);
        // Bump last_seen; refresh device_id if newly provided.
        await sql`
          UPDATE push_tokens
          SET last_seen_at = ${now}, device_id = COALESCE(${deviceId ?? null}, device_id)
          WHERE id = ${tok.id}
        `;
        tok.lastSeenAt = now.toISOString();
        if (deviceId) tok.deviceId = deviceId;
        memory.set(tok.id, tok);
        memBucket(userId).add(tok.id);
        return tok;
      }
      const id = newId();
      await sql`
        INSERT INTO push_tokens (id, user_id, device_id, expo_token, platform, prefs, last_seen_at, created_at)
        VALUES (${id}, ${userId}, ${deviceId ?? null}, ${expoToken}, ${platform}, ${"{}"}::jsonb, ${now}, ${now})
      `;
      const tok: PushToken = {
        id,
        userId,
        deviceId,
        expoToken,
        platform,
        prefs: {},
        lastSeenAt: now.toISOString(),
        createdAt: now.toISOString(),
      };
      memory.set(id, tok);
      memBucket(userId).add(id);
      return tok;
    }
  }

  // Memory fallback — find existing (userId, expoToken).
  for (const tid of memBucket(userId)) {
    const t = memory.get(tid);
    if (t && t.expoToken === expoToken) {
      t.lastSeenAt = now.toISOString();
      if (deviceId) t.deviceId = deviceId;
      return t;
    }
  }
  const id = newId();
  const tok: PushToken = {
    id,
    userId,
    deviceId,
    expoToken,
    platform,
    prefs: {},
    lastSeenAt: now.toISOString(),
    createdAt: now.toISOString(),
  };
  memory.set(id, tok);
  memBucket(userId).add(id);
  return tok;
}

export async function unregisterPushToken(userId: string, tokenId: string): Promise<boolean> {
  await ensureTable();
  let removed = false;
  const t = memory.get(tokenId);
  if (t && t.userId === userId) {
    memory.delete(tokenId);
    memBucket(userId).delete(tokenId);
    removed = true;
  }
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        DELETE FROM push_tokens WHERE id = ${tokenId} AND user_id = ${userId} RETURNING id
      `) as unknown[];
      if (rows.length > 0) removed = true;
    }
  }
  return removed;
}

/**
 * Shallow-merge patch into the stored `prefs` blob. Missing keys are left
 * untouched. Values MUST be JSON-serializable.
 */
export async function updatePrefs(
  userId: string,
  tokenId: string,
  patch: PushPrefs,
): Promise<PushToken | null> {
  await ensureTable();
  // Read the current token from memory (populated from DB by list/register
  // calls, warm across the process) — falls back to a DB roundtrip if this
  // process hasn't seen the token yet.
  let tok = memory.get(tokenId) ?? null;
  if (!tok && dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        SELECT id, user_id, device_id, expo_token, platform, prefs, last_seen_at, created_at
        FROM push_tokens WHERE id = ${tokenId} AND user_id = ${userId} LIMIT 1
      `) as Row[];
      if (rows.length > 0) tok = rowToToken(rows[0]!);
    }
  }
  if (!tok || tok.userId !== userId) return null;

  const merged: PushPrefs = { ...tok.prefs, ...patch };
  // Deep-merge nested last_sent so per-event dedupe keys don't get clobbered.
  if (tok.prefs.last_sent || patch.last_sent) {
    merged.last_sent = { ...(tok.prefs.last_sent ?? {}), ...(patch.last_sent ?? {}) };
  }
  tok.prefs = merged;
  memory.set(tok.id, tok);
  memBucket(userId).add(tok.id);

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      await sql`
        UPDATE push_tokens
        SET prefs = ${JSON.stringify(merged)}::jsonb, last_seen_at = now()
        WHERE id = ${tok.id} AND user_id = ${userId}
      `;
    }
  }
  return tok;
}

export async function listTokensForUser(userId: string): Promise<PushToken[]> {
  await ensureTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        SELECT id, user_id, device_id, expo_token, platform, prefs, last_seen_at, created_at
        FROM push_tokens
        WHERE user_id = ${userId}
        ORDER BY last_seen_at DESC
      `) as Row[];
      const out = rows.map(rowToToken);
      const bucket = memBucket(userId);
      bucket.clear();
      for (const t of out) {
        memory.set(t.id, t);
        bucket.add(t.id);
      }
      return out;
    }
  }
  return [...memBucket(userId)]
    .map((id) => memory.get(id))
    .filter((t): t is PushToken => Boolean(t))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

/**
 * Every token whose `prefs[eventKey] === true`. Used by scheduled notifiers
 * that need to fan out to the entire opt-in cohort. Returns tokens grouped
 * by `userId` so callers can dedupe per-user work (avoid generating the same
 * daily brief once per registered device).
 */
export async function listTokensForEvent(
  eventKey: PushEventKey,
): Promise<PushToken[]> {
  await ensureTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        SELECT id, user_id, device_id, expo_token, platform, prefs, last_seen_at, created_at
        FROM push_tokens
        WHERE (prefs ->> ${eventKey}) = 'true'
        ORDER BY last_seen_at DESC
      `) as Row[];
      const out = rows.map(rowToToken);
      // Warm memory cache.
      for (const t of out) {
        memory.set(t.id, t);
        memBucket(t.userId).add(t.id);
      }
      return out;
    }
  }
  const out: PushToken[] = [];
  for (const t of memory.values()) {
    if (t.prefs[eventKey] === true) out.push(t);
  }
  return out;
}

/** Same as `listTokensForEvent` but filters to a specific user. */
export async function listTokensForUserAndEvent(
  userId: string,
  eventKey: PushEventKey,
): Promise<PushToken[]> {
  const all = await listTokensForUser(userId);
  return all.filter((t) => t.prefs[eventKey] === true);
}

/** Test hook. */
export function _resetPushTokenMemory(): void {
  memory.clear();
  memoryByUser.clear();
  tableReady = false;
}
