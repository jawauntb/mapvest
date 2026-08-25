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
 *   push_token_claims (
 *     expo_token    text primary key,
 *     token_id      text,                       -- null is an explicit revocation tombstone
 *     user_id       text,
 *     claimed_at    timestamptz not null
 *   )
 *
 * The `prefs` blob carries every per-event opt-in as a boolean, the persisted
 * product-level `notifications_enabled` mute, AND a small amount of scheduler
 * state (last-known lat/lng, last daily-brief send date). Keeping it JSONB
 * keeps schema churn to zero as new event types land. `push_token_claims`
 * supplies the global ownership invariant that the historical per-user
 * unique constraint cannot express: only its claimed row is deliverable.
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
  "find_evolution",
  "uncaught_nearby",
] as const;

export type PushEventKey = (typeof PUSH_EVENT_KEYS)[number];

export type PushPrefs = Partial<Record<PushEventKey, boolean>> & {
  /** Product-level notification switch for this device. New tokens default false. */
  notifications_enabled?: boolean;
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

/**
 * Whether Mapvest is allowed to deliver notifications to this token.
 *
 * Tokens created before the master switch existed have no value. They are
 * treated as enabled so an existing, explicitly opted-in event preference is
 * not silently revoked by the migration. New registrations persist `false`
 * until the user turns the master switch on in Settings.
 */
export function pushNotificationsEnabled(token: Pick<PushToken, "prefs">): boolean {
  return token.prefs.notifications_enabled !== false;
}

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

/**
 * The in-memory path is the test/local equivalent of `push_token_claims`.
 * Remove an old owner before making a token visible to a new owner, so one
 * Expo token can never be selected for two users in a process.
 */
function removeMemoryRowsForExpoToken(expoToken: string, exceptId?: string): void {
  for (const [id, token] of memory) {
    if (token.expoToken !== expoToken || id === exceptId) continue;
    memory.delete(id);
    memoryByUser.get(token.userId)?.delete(id);
  }
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
  await sql`
    CREATE TABLE IF NOT EXISTS push_token_claims (
      expo_token TEXT PRIMARY KEY,
      token_id TEXT,
      user_id TEXT,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS push_token_claims_user_idx ON push_token_claims (user_id)`;

  // Do not delete or rewrite legacy duplicate rows during a lazy startup
  // migration. Instead, elect one deterministic (most recently seen) owner
  // per Expo token. Every delivery/read/write query below joins this table,
  // so the unclaimed historical rows are immediately non-deliverable. A
  // future registration atomically replaces the claim and resets consent.
  await sql`
    INSERT INTO push_token_claims (expo_token, token_id, user_id, claimed_at)
    SELECT DISTINCT ON (expo_token) expo_token, id, user_id, last_seen_at
    FROM push_tokens
    ORDER BY expo_token, last_seen_at DESC, id DESC
    ON CONFLICT (expo_token) DO NOTHING
  `;
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
  const prefs = (
    typeof row.prefs === "string"
      ? (() => {
          try {
            return JSON.parse(row.prefs);
          } catch {
            return {};
          }
        })()
      : row.prefs && typeof row.prefs === "object"
        ? (row.prefs as PushPrefs)
        : {}
  ) as PushPrefs;
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
 * Idempotent registration with global token ownership. Same-account launches
 * retain their existing prefs; registration from another account atomically
 * transfers the token claim and starts with all notification prefs muted.
 * `last_seen_at` is bumped on every call so the scheduler can later evict
 * stale tokens if needed.
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
      const tok = await sql.begin(async (tx) => {
        // Claims for the same Expo token serialize even when two API
        // instances receive account-switch registration at the same time.
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${expoToken}, 0))`;
        const active = (await tx`
          SELECT p.id, p.user_id, p.device_id, p.expo_token, p.platform, p.prefs, p.last_seen_at, p.created_at
          FROM push_token_claims AS c
          JOIN push_tokens AS p ON p.id = c.token_id AND p.user_id = c.user_id
          WHERE c.expo_token = ${expoToken}
          FOR UPDATE OF c, p
        `) as Row[];

        if (active[0]?.user_id === userId) {
          const updated = (await tx`
            UPDATE push_tokens
            SET last_seen_at = ${now}, device_id = COALESCE(${deviceId ?? null}, device_id)
            WHERE id = ${active[0].id} AND user_id = ${userId}
            RETURNING id, user_id, device_id, expo_token, platform, prefs, last_seen_at, created_at
          `) as Row[];
          return rowToToken(updated[0]!);
        }

        // A legacy row may already exist for this user. Reuse it, but reset
        // every preference because this is a new ownership claim, never a
        // continuation of consent granted under another account.
        const existingForNewOwner = (await tx`
          SELECT id, user_id, device_id, expo_token, platform, prefs, last_seen_at, created_at
          FROM push_tokens
          WHERE user_id = ${userId} AND expo_token = ${expoToken}
          ORDER BY last_seen_at DESC, id DESC
          LIMIT 1
          FOR UPDATE
        `) as Row[];
        const resetPrefs = JSON.stringify({ notifications_enabled: false });
        let claimed: Row[];
        if (existingForNewOwner.length > 0) {
          claimed = (await tx`
            UPDATE push_tokens
            SET device_id = ${deviceId ?? null}, platform = ${platform}, prefs = ${resetPrefs}::jsonb, last_seen_at = ${now}
            WHERE id = ${existingForNewOwner[0]!.id} AND user_id = ${userId}
            RETURNING id, user_id, device_id, expo_token, platform, prefs, last_seen_at, created_at
          `) as Row[];
        } else {
          const id = newId();
          claimed = (await tx`
            INSERT INTO push_tokens (id, user_id, device_id, expo_token, platform, prefs, last_seen_at, created_at)
            VALUES (${id}, ${userId}, ${deviceId ?? null}, ${expoToken}, ${platform}, ${resetPrefs}::jsonb, ${now}, ${now})
            RETURNING id, user_id, device_id, expo_token, platform, prefs, last_seen_at, created_at
          `) as Row[];
        }
        const token = rowToToken(claimed[0]!);
        await tx`
          INSERT INTO push_token_claims (expo_token, token_id, user_id, claimed_at)
          VALUES (${expoToken}, ${token.id}, ${userId}, ${now})
          ON CONFLICT (expo_token) DO UPDATE
          SET token_id = EXCLUDED.token_id, user_id = EXCLUDED.user_id, claimed_at = EXCLUDED.claimed_at
        `;
        return token;
      });
      removeMemoryRowsForExpoToken(expoToken, tok.id);
      memory.set(tok.id, tok);
      memBucket(userId).add(tok.id);
      return tok;
    }
  }

  // Memory fallback — the same Expo token has exactly one owner.
  const existing = [...memory.values()].find((token) => token.expoToken === expoToken);
  if (existing?.userId === userId) {
    existing.lastSeenAt = now.toISOString();
    if (deviceId) existing.deviceId = deviceId;
    removeMemoryRowsForExpoToken(expoToken, existing.id);
    return existing;
  }

  // Account switch: remove the old owner and never carry over its consent.
  removeMemoryRowsForExpoToken(expoToken);
  const id = newId();
  const tok: PushToken = {
    id,
    userId,
    deviceId,
    expoToken,
    platform,
    prefs: { notifications_enabled: false },
    lastSeenAt: now.toISOString(),
    createdAt: now.toISOString(),
  };
  memory.set(id, tok);
  memBucket(userId).add(id);
  return tok;
}

export async function unregisterPushToken(userId: string, tokenId: string): Promise<boolean> {
  await ensureTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const removed = await sql.begin(async (tx) => {
        // Lock the claim together with its active row. Registration also
        // locks this claim, so an account switch cannot interleave with
        // revocation and resurrect a token after this call succeeds.
        const active = (await tx`
          SELECT c.expo_token
          FROM push_token_claims AS c
          JOIN push_tokens AS p ON p.id = c.token_id AND p.user_id = c.user_id
          WHERE p.id = ${tokenId} AND p.user_id = ${userId}
          FOR UPDATE OF c, p
        `) as { expo_token: string }[];
        if (active.length === 0) return false;
        await tx`DELETE FROM push_tokens WHERE id = ${tokenId} AND user_id = ${userId}`;
        // Keep a tombstone rather than deleting the claim. A process restart
        // must not promote a legacy duplicate after an explicit unlink.
        await tx`
          UPDATE push_token_claims
          SET token_id = NULL, user_id = NULL, claimed_at = now()
          WHERE expo_token = ${active[0]!.expo_token}
        `;
        return true;
      });
      if (removed) {
        memory.delete(tokenId);
        memBucket(userId).delete(tokenId);
      }
      return removed;
    }
  }

  const token = memory.get(tokenId);
  if (!token || token.userId !== userId) return false;
  memory.delete(tokenId);
  memBucket(userId).delete(tokenId);
  return true;
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
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const updated = await sql.begin(async (tx) => {
        // A claim lock makes this check-and-write atomic with registration.
        // An old account can never update a row after a new account claims
        // the same physical Expo token.
        const active = (await tx`
          SELECT p.id, p.user_id, p.device_id, p.expo_token, p.platform, p.prefs, p.last_seen_at, p.created_at
          FROM push_token_claims AS c
          JOIN push_tokens AS p ON p.id = c.token_id AND p.user_id = c.user_id
          WHERE p.id = ${tokenId} AND p.user_id = ${userId}
          FOR UPDATE OF c, p
        `) as Row[];
        if (active.length === 0) return null;
        const token = rowToToken(active[0]!);
        const merged: PushPrefs = { ...token.prefs, ...patch };
        // Deep-merge nested last_sent so per-event dedupe keys don't get clobbered.
        if (token.prefs.last_sent || patch.last_sent) {
          merged.last_sent = { ...(token.prefs.last_sent ?? {}), ...(patch.last_sent ?? {}) };
        }
        const rows = (await tx`
          UPDATE push_tokens
          SET prefs = ${JSON.stringify(merged)}::jsonb, last_seen_at = now()
          WHERE id = ${token.id} AND user_id = ${userId}
          RETURNING id, user_id, device_id, expo_token, platform, prefs, last_seen_at, created_at
        `) as Row[];
        return rowToToken(rows[0]!);
      });
      if (updated) {
        removeMemoryRowsForExpoToken(updated.expoToken, updated.id);
        memory.set(updated.id, updated);
        memBucket(userId).add(updated.id);
      }
      return updated;
    }
  }

  const tok = memory.get(tokenId);
  if (!tok || tok.userId !== userId) return null;
  const merged: PushPrefs = { ...tok.prefs, ...patch };
  // Deep-merge nested last_sent so per-event dedupe keys don't get clobbered.
  if (tok.prefs.last_sent || patch.last_sent) {
    merged.last_sent = { ...(tok.prefs.last_sent ?? {}), ...(patch.last_sent ?? {}) };
  }
  tok.prefs = merged;
  memory.set(tok.id, tok);
  memBucket(userId).add(tok.id);
  return tok;
}

export async function listTokensForUser(userId: string): Promise<PushToken[]> {
  await ensureTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        SELECT p.id, p.user_id, p.device_id, p.expo_token, p.platform, p.prefs, p.last_seen_at, p.created_at
        FROM push_token_claims AS c
        JOIN push_tokens AS p ON p.id = c.token_id AND p.user_id = c.user_id
        WHERE c.user_id = ${userId}
        ORDER BY p.last_seen_at DESC
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
export async function listTokensForEvent(eventKey: PushEventKey): Promise<PushToken[]> {
  await ensureTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        SELECT p.id, p.user_id, p.device_id, p.expo_token, p.platform, p.prefs, p.last_seen_at, p.created_at
        FROM push_token_claims AS c
        JOIN push_tokens AS p ON p.id = c.token_id AND p.user_id = c.user_id
        WHERE (p.prefs ->> ${eventKey}) = 'true'
          AND (p.prefs ->> 'notifications_enabled') IS DISTINCT FROM 'false'
        ORDER BY p.last_seen_at DESC
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
  return out.filter(pushNotificationsEnabled);
}

/** Same as `listTokensForEvent` but filters to a specific user. */
export async function listTokensForUserAndEvent(
  userId: string,
  eventKey: PushEventKey,
): Promise<PushToken[]> {
  const all = await listTokensForUser(userId);
  return all.filter((t) => t.prefs[eventKey] === true && pushNotificationsEnabled(t));
}

/** Test hook. */
export function _resetPushTokenMemory(): void {
  memory.clear();
  memoryByUser.clear();
  tableReady = false;
}
