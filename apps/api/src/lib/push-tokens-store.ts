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
 *   push_delivery_claims (
 *     claim_id      text primary key,
 *     delivery_group text not null,
 *     token_id      text not null,
 *     user_id       text not null,
 *     expo_token    text not null,
 *     dedupe_slot   text not null,
 *     dedupe_key    text not null,
 *     lease_until   timestamptz not null
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

export type PushDeliveryDedupe = {
  slot: string;
  key: string;
  /** How long a successful send should block this dedupe key. */
  ttlMs?: number;
};

export type PushDeliveryClaim = {
  claimId: string;
  tokenId: string;
  userId: string;
  expoToken: string;
  dedupe: PushDeliveryDedupe[];
  leaseUntil: string;
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
const memoryDeliveryClaims = new Map<string, { claim: PushDeliveryClaim; expiresAt: number }>();

// Claiming is deliberately serialized in the fallback store. The real store
// uses row/advisory locks; tests and local development need the same
// selection -> dispatch ownership invariant within one process.
let memoryClaimQueue: Promise<void> = Promise.resolve();

function withMemoryClaimLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = memoryClaimQueue.then(fn, fn);
  memoryClaimQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

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
let failNextClaimUpsert = false;
let tableInitPromise: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  if (!tableInitPromise) {
    tableInitPromise = initializePushTables().catch((error) => {
      tableInitPromise = null;
      throw error;
    });
  }
  await tableInitPromise;
}

async function initializePushTables(): Promise<void> {
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
  await sql`
    CREATE TABLE IF NOT EXISTS push_delivery_claims (
      claim_id TEXT PRIMARY KEY,
      delivery_group TEXT,
      token_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      expo_token TEXT NOT NULL,
      dedupe_slot TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      lease_until TIMESTAMPTZ NOT NULL,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (token_id, dedupe_slot, dedupe_key)
    )
  `;
  await sql`ALTER TABLE push_delivery_claims ADD COLUMN IF NOT EXISTS delivery_group TEXT`;
  await sql`UPDATE push_delivery_claims SET delivery_group = claim_id WHERE delivery_group IS NULL`;
  await sql`ALTER TABLE push_delivery_claims ALTER COLUMN delivery_group SET NOT NULL`;
  await sql`
    CREATE INDEX IF NOT EXISTS push_delivery_claims_lease_idx
    ON push_delivery_claims (lease_until)
  `;

  // Roll-forward safety for old API binaries that still select push_tokens
  // directly. A legacy row without the authoritative claim is muted on every
  // prefs write, so an old preference endpoint cannot resurrect delivery after
  // an account transfer or unlink.
  await sql`
    CREATE OR REPLACE FUNCTION mapvest_mute_unclaimed_push_token()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM push_token_claims AS c
        WHERE c.expo_token = NEW.expo_token
          AND c.token_id = NEW.id
          AND c.user_id = NEW.user_id
      ) THEN
        NEW.prefs := CASE
          WHEN jsonb_typeof(NEW.prefs) = 'object' THEN NEW.prefs
          ELSE '{}'::jsonb
        END
          || jsonb_build_object(
            'notifications_enabled', false,
            'daily_brief', false,
            'local_brief', false,
            'price_alerts', false,
            'memo_finished', false,
            'agent_response', false,
            'identify_done', false,
            'watchlist_mover', false,
            'find_evolution', false,
            'uncaught_nearby', false
          );
      END IF;
      RETURN NEW;
    END;
    $$
  `;
  await sql`DROP TRIGGER IF EXISTS push_tokens_mute_unclaimed ON push_tokens`;
  await sql`
    CREATE TRIGGER push_tokens_mute_unclaimed
    BEFORE INSERT OR UPDATE OF prefs ON push_tokens
    FOR EACH ROW EXECUTE FUNCTION mapvest_mute_unclaimed_push_token()
  `;
  await sql`
    CREATE OR REPLACE FUNCTION mapvest_mute_unclaimed_push_rows()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    DECLARE
      affected_expo_token TEXT;
    BEGIN
      affected_expo_token := CASE WHEN TG_OP = 'DELETE' THEN OLD.expo_token ELSE NEW.expo_token END;
      UPDATE push_tokens AS p
      SET prefs = CASE
        WHEN jsonb_typeof(p.prefs) = 'object' THEN p.prefs
        ELSE '{}'::jsonb
      END
        || jsonb_build_object(
          'notifications_enabled', false,
          'daily_brief', false,
          'local_brief', false,
          'price_alerts', false,
          'memo_finished', false,
          'agent_response', false,
          'identify_done', false,
          'watchlist_mover', false,
          'find_evolution', false,
          'uncaught_nearby', false
        )
      WHERE p.expo_token = affected_expo_token
        AND NOT EXISTS (
          SELECT 1
          FROM push_token_claims AS c
          WHERE c.expo_token = p.expo_token
            AND c.token_id = p.id
            AND c.user_id = p.user_id
        );
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END;
    $$
  `;
  await sql`DROP TRIGGER IF EXISTS push_token_claims_mute_legacy ON push_token_claims`;
  await sql`
    CREATE TRIGGER push_token_claims_mute_legacy
    AFTER INSERT OR UPDATE OR DELETE ON push_token_claims
    FOR EACH ROW EXECUTE FUNCTION mapvest_mute_unclaimed_push_rows()
  `;

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
  // The election above makes only one historical row active. Explicitly mute
  // every other row as well because old API binaries may bypass the claim join.
  await sql`
    UPDATE push_tokens AS p
    SET prefs = CASE
      WHEN jsonb_typeof(p.prefs) = 'object' THEN p.prefs
      ELSE '{}'::jsonb
    END
      || jsonb_build_object(
        'notifications_enabled', false,
        'daily_brief', false,
        'local_brief', false,
        'price_alerts', false,
        'memo_finished', false,
        'agent_response', false,
        'identify_done', false,
        'watchlist_mover', false,
        'find_evolution', false,
        'uncaught_nearby', false
      )
    WHERE NOT EXISTS (
      SELECT 1
      FROM push_token_claims AS c
      WHERE c.expo_token = p.expo_token
        AND c.token_id = p.id
        AND c.user_id = p.user_id
    )
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
  const parsePrefs = (value: unknown): PushPrefs => {
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as PushPrefs;
      } catch {
        return {};
      }
    }
    if (Array.isArray(value)) {
      // Bun/Postgres can expose a JSONB value as the driver's raw string plus
      // decoded object when a BEFORE trigger changed it in the same RETURNING
      // statement. Prefer the decoded object, then fall back to the string.
      for (const item of value) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          return item as PushPrefs;
        }
      }
      for (const item of value) {
        if (typeof item === "string") return parsePrefs(item);
      }
      return {};
    }
    return value && typeof value === "object" ? (value as PushPrefs) : {};
  };
  const prefs = parsePrefs(row.prefs);
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

function mutedPrefs(): PushPrefs {
  return {
    notifications_enabled: false,
    ...Object.fromEntries(PUSH_EVENT_KEYS.map((key) => [key, false])),
  } as PushPrefs;
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
        const resetPrefs = mutedPrefs();
        let claimed: Row[];
        if (existingForNewOwner.length > 0) {
          claimed = (await tx`
            UPDATE push_tokens
            SET device_id = ${deviceId ?? null}, platform = ${platform}, prefs = ${resetPrefs}, last_seen_at = ${now}
            WHERE id = ${existingForNewOwner[0]!.id} AND user_id = ${userId}
            RETURNING id, user_id, device_id, expo_token, platform, prefs, last_seen_at, created_at
          `) as Row[];
        } else {
          const id = newId();
          claimed = (await tx`
            INSERT INTO push_tokens (id, user_id, device_id, expo_token, platform, prefs, last_seen_at, created_at)
            VALUES (${id}, ${userId}, ${deviceId ?? null}, ${expoToken}, ${platform}, ${resetPrefs}, ${now}, ${now})
            RETURNING id, user_id, device_id, expo_token, platform, prefs, last_seen_at, created_at
          `) as Row[];
        }
        const token = rowToToken(claimed[0]!);
        if (failNextClaimUpsert) {
          failNextClaimUpsert = false;
          throw new Error("injected push claim upsert failure");
        }
        await tx`
          INSERT INTO push_token_claims (expo_token, token_id, user_id, claimed_at)
          VALUES (${expoToken}, ${token.id}, ${userId}, ${now})
          ON CONFLICT (expo_token) DO UPDATE
          SET token_id = EXCLUDED.token_id, user_id = EXCLUDED.user_id, claimed_at = EXCLUDED.claimed_at
        `;
        await tx`DELETE FROM push_delivery_claims WHERE expo_token = ${expoToken}`;
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
    prefs: mutedPrefs(),
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
        await tx`DELETE FROM push_delivery_claims WHERE expo_token = ${active[0]!.expo_token}`;
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
  for (const [key, entry] of memoryDeliveryClaims) {
    if (entry.claim.tokenId === tokenId) memoryDeliveryClaims.delete(key);
  }
  return true;
}

/**
 * Idempotent revocation for the physical installation identity. This route is
 * intentionally narrower than authenticated token deletion: possession of an
 * Expo token (and, when available, the device id) can only mute/unlink that
 * installation. It is the recovery path when SecureStore lost the server id
 * or the session has expired before sign-out can use the authenticated route.
 */
export async function unregisterPushTokenByIdentity(
  expoToken: string,
  deviceId?: string,
  tokenId?: string,
): Promise<boolean> {
  await ensureTable();
  if (!expoToken) return false;
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const removed = await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${expoToken}, 0))`;
        const active = (await tx`
          SELECT c.expo_token, c.token_id, c.user_id
          FROM push_token_claims AS c
          JOIN push_tokens AS p ON p.id = c.token_id AND p.user_id = c.user_id
          WHERE c.expo_token = ${expoToken}
            AND (${tokenId ?? null}::text IS NULL OR p.id = ${tokenId ?? null})
            AND (${deviceId ?? null}::text IS NULL OR p.device_id = ${deviceId ?? null})
          FOR UPDATE OF c, p
        `) as { expo_token: string; token_id: string; user_id: string }[];
        if (active.length === 0) return false;
        await tx`DELETE FROM push_tokens WHERE id = ${active[0]!.token_id}`;
        await tx`
          UPDATE push_token_claims
          SET token_id = NULL, user_id = NULL, claimed_at = now()
          WHERE expo_token = ${expoToken}
        `;
        await tx`DELETE FROM push_delivery_claims WHERE expo_token = ${expoToken}`;
        return true;
      });
      if (removed) removeMemoryRowsForExpoToken(expoToken);
      return removed;
    }
  }

  const token = [...memory.values()].find(
    (candidate) =>
      candidate.expoToken === expoToken &&
      (!tokenId || candidate.id === tokenId) &&
      (!deviceId || candidate.deviceId === deviceId),
  );
  if (!token) return false;
  memory.delete(token.id);
  memoryByUser.get(token.userId)?.delete(token.id);
  for (const [key, entry] of memoryDeliveryClaims) {
    if (entry.claim.expoToken === expoToken) memoryDeliveryClaims.delete(key);
  }
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
          SET prefs = ${merged}, last_seen_at = now()
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

function deliveryClaimId(): string {
  return `delivery_${crypto.randomUUID().replace(/-/g, "")}`;
}

function deliveryKey(tokenId: string, slot: string, key: string): string {
  return `${tokenId}\u0000${slot}\u0000${key}`;
}

function normalizedDedupe(dedupe: PushDeliveryDedupe[]): PushDeliveryDedupe[] {
  const seen = new Set<string>();
  const out: PushDeliveryDedupe[] = [];
  for (const item of dedupe) {
    const slot = item.slot.trim();
    const key = item.key.trim();
    if (!slot || !key) continue;
    const id = `${slot}\u0000${key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ slot, key, ttlMs: item.ttlMs });
  }
  return out;
}

function pruneMemoryDeliveryClaims(): void {
  const now = Date.now();
  for (const [key, entry] of memoryDeliveryClaims) {
    if (entry.expiresAt <= now) memoryDeliveryClaims.delete(key);
  }
}

function memoryTokenIsEligible(token: PushToken, eventKey?: PushEventKey): boolean {
  return pushNotificationsEnabled(token) && (eventKey ? token.prefs[eventKey] === true : true);
}

/**
 * Atomically reserve a candidate token for a deduped delivery. Callers must
 * validate the returned lease immediately before handing it to Expo and must
 * finalize it afterwards. A claim is never consent: it is only a short-lived
 * ownership lease over the server-side selection.
 */
export async function claimPushDelivery(
  tokens: PushToken[],
  dedupe: PushDeliveryDedupe[],
  eventKey?: PushEventKey,
  leaseMs = 30_000,
): Promise<PushDeliveryClaim[]> {
  const keys = normalizedDedupe(dedupe);
  if (keys.length === 0 || tokens.length === 0) return [];
  await ensureTable();

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const candidateIds = [...new Set(tokens.map((token) => token.id))].sort();
      return sql.begin(async (tx) => {
        const now = new Date();
        const leaseUntil = new Date(now.getTime() + leaseMs);
        await tx`DELETE FROM push_delivery_claims WHERE lease_until <= ${now}`;
        const rows = (await tx`
          SELECT p.id, p.user_id, p.device_id, p.expo_token, p.platform, p.prefs,
                 p.last_seen_at, p.created_at
          FROM push_token_claims AS c
          JOIN push_tokens AS p ON p.id = c.token_id AND p.user_id = c.user_id
          WHERE p.id = ANY(${sql.array(candidateIds, "text")})
            AND (${eventKey ?? null}::text IS NULL OR (p.prefs ->> ${eventKey ?? ""}) = 'true')
            AND (p.prefs ->> 'notifications_enabled') IS DISTINCT FROM 'false'
          ORDER BY p.id
          FOR UPDATE OF c, p
        `) as Row[];
        const claims: PushDeliveryClaim[] = [];
        for (const row of rows) {
          const token = rowToToken(row);
          if (keys.some((item) => token.prefs.last_sent?.[item.slot] === item.key)) continue;
          let busy = false;
          for (const item of keys) {
            const existing = await tx`
              SELECT claim_id
              FROM push_delivery_claims
              WHERE token_id = ${token.id}
                AND dedupe_slot = ${item.slot}
                AND dedupe_key = ${item.key}
                AND lease_until > ${now}
              LIMIT 1
            `;
            if (existing.length > 0) {
              busy = true;
              break;
            }
          }
          if (busy) continue;
          const deliveryGroup = deliveryClaimId();
          const claimRows: Array<{ claim_id: string }> = [];
          for (const item of keys) {
            const claimId = deliveryClaimId();
            const inserted = (await tx`
              INSERT INTO push_delivery_claims
                (claim_id, delivery_group, token_id, user_id, expo_token, dedupe_slot, dedupe_key, lease_until)
              VALUES
                (${claimId}, ${deliveryGroup}, ${token.id}, ${token.userId}, ${token.expoToken}, ${item.slot}, ${item.key}, ${leaseUntil})
              ON CONFLICT (token_id, dedupe_slot, dedupe_key) DO NOTHING
              RETURNING claim_id
            `) as Array<{ claim_id: string }>;
            if (inserted.length === 0) {
              busy = true;
              break;
            }
            claimRows.push(inserted[0]!);
          }
          if (busy) {
            for (const inserted of claimRows) {
              await tx`DELETE FROM push_delivery_claims WHERE claim_id = ${inserted.claim_id}`;
            }
            continue;
          }
          claims.push({
            claimId: deliveryGroup,
            tokenId: token.id,
            userId: token.userId,
            expoToken: token.expoToken,
            dedupe: keys,
            leaseUntil: leaseUntil.toISOString(),
          });
        }
        return claims;
      });
    }
  }

  return withMemoryClaimLock(async () => {
    pruneMemoryDeliveryClaims();
    const now = Date.now();
    const leaseUntil = new Date(now + leaseMs);
    const claims: PushDeliveryClaim[] = [];
    const seen = new Set<string>();
    for (const token of tokens) {
      if (seen.has(token.id) || !memoryTokenIsEligible(token, eventKey)) continue;
      seen.add(token.id);
      if (keys.some((item) => token.prefs.last_sent?.[item.slot] === item.key)) continue;
      if (
        keys.some((item) => memoryDeliveryClaims.has(deliveryKey(token.id, item.slot, item.key)))
      ) {
        continue;
      }
      const claim: PushDeliveryClaim = {
        claimId: deliveryClaimId(),
        tokenId: token.id,
        userId: token.userId,
        expoToken: token.expoToken,
        dedupe: keys,
        leaseUntil: leaseUntil.toISOString(),
      };
      for (const item of keys) {
        memoryDeliveryClaims.set(deliveryKey(token.id, item.slot, item.key), {
          claim,
          expiresAt: leaseUntil.getTime(),
        });
      }
      claims.push(claim);
    }
    return claims;
  });
}

/** Re-check the active account claim, consent, and lease immediately pre-send. */
export async function validatePushDeliveryClaims(
  claims: PushDeliveryClaim[],
  eventKey?: PushEventKey,
): Promise<PushDeliveryClaim[]> {
  if (claims.length === 0) return [];
  await ensureTable();
  const grouped = new Map<string, PushDeliveryClaim>();
  for (const claim of claims) grouped.set(claim.claimId, claim);

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const valid = await sql`
        SELECT d.delivery_group, d.dedupe_slot, d.dedupe_key
        FROM push_delivery_claims AS d
        JOIN push_token_claims AS c
          ON c.expo_token = d.expo_token
         AND c.token_id = d.token_id
         AND c.user_id = d.user_id
        JOIN push_tokens AS p ON p.id = d.token_id AND p.user_id = d.user_id
        WHERE d.delivery_group = ANY(${sql.array([...grouped.keys()], "text")})
          AND d.lease_until > now()
          AND (p.prefs ->> 'notifications_enabled') IS DISTINCT FROM 'false'
          AND (${eventKey ?? null}::text IS NULL OR (p.prefs ->> ${eventKey ?? ""}) = 'true')
      `;
      const validKeys = new Set(
        (valid as Array<{ delivery_group: string; dedupe_slot: string; dedupe_key: string }>).map(
          (row) => `${row.delivery_group}\u0000${row.dedupe_slot}\u0000${row.dedupe_key}`,
        ),
      );
      // A delivery group is valid only when all of its dedupe rows survived.
      return claims.filter((claim) => {
        return claim.dedupe.every((item) =>
          validKeys.has(`${claim.claimId}\u0000${item.slot}\u0000${item.key}`),
        );
      });
    }
  }

  return withMemoryClaimLock(async () => {
    pruneMemoryDeliveryClaims();
    return claims.filter((claim) => {
      const token = memory.get(claim.tokenId);
      if (!token || token.userId !== claim.userId || token.expoToken !== claim.expoToken)
        return false;
      if (!memoryTokenIsEligible(token, eventKey)) return false;
      return claim.dedupe.every((item) => {
        const entry = memoryDeliveryClaims.get(deliveryKey(claim.tokenId, item.slot, item.key));
        return entry?.claim.claimId === claim.claimId;
      });
    });
  });
}

/**
 * Finalize a lease after the downstream handoff. Only the still-active claim
 * may persist dedupe state; account transfers/unlinks that win during the
 * network call therefore cannot receive an old account's write.
 */
export async function finalizePushDelivery(
  claims: PushDeliveryClaim[],
  successfulExpoTokens: ReadonlySet<string>,
  invalidExpoTokens: ReadonlySet<string> = new Set(),
): Promise<void> {
  if (claims.length === 0) return;
  await ensureTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      await sql.begin(async (tx) => {
        const now = new Date();
        for (const claim of [...claims].sort((a, b) => a.tokenId.localeCompare(b.tokenId))) {
          const active = (await tx`
            SELECT p.id, p.user_id, p.device_id, p.expo_token, p.platform, p.prefs,
                   p.last_seen_at, p.created_at
            FROM push_delivery_claims AS d
            JOIN push_token_claims AS c
              ON c.expo_token = d.expo_token
             AND c.token_id = d.token_id
             AND c.user_id = d.user_id
            JOIN push_tokens AS p ON p.id = d.token_id AND p.user_id = d.user_id
            WHERE d.delivery_group = ${claim.claimId}
              AND d.lease_until > ${now}
            FOR UPDATE OF d, c, p
          `) as Row[];
          if (active.length > 0) {
            const token = rowToToken(active[0]!);
            const lastSent: Record<string, string> = {};
            for (const item of claim.dedupe) lastSent[item.slot] = item.key;
            const merged: PushPrefs = {
              ...token.prefs,
              last_sent: { ...(token.prefs.last_sent ?? {}), ...lastSent },
            };
            if (invalidExpoTokens.has(claim.expoToken)) {
              await tx`DELETE FROM push_tokens WHERE id = ${claim.tokenId} AND user_id = ${claim.userId}`;
              await tx`
                UPDATE push_token_claims
                SET token_id = NULL, user_id = NULL, claimed_at = now()
                WHERE expo_token = ${claim.expoToken}
              `;
            } else if (successfulExpoTokens.has(claim.expoToken)) {
              await tx`
                UPDATE push_tokens
                SET prefs = ${merged}, last_seen_at = now()
                WHERE id = ${claim.tokenId} AND user_id = ${claim.userId}
              `;
            }
          }
          await tx`DELETE FROM push_delivery_claims WHERE delivery_group = ${claim.claimId}`;
        }
      });
      return;
    }
  }

  await withMemoryClaimLock(async () => {
    pruneMemoryDeliveryClaims();
    for (const claim of claims) {
      const valid = claim.dedupe.every((item) => {
        const entry = memoryDeliveryClaims.get(deliveryKey(claim.tokenId, item.slot, item.key));
        return entry?.claim.claimId === claim.claimId;
      });
      const token = memory.get(claim.tokenId);
      if (valid && token && token.userId === claim.userId && token.expoToken === claim.expoToken) {
        if (invalidExpoTokens.has(claim.expoToken)) {
          memory.delete(token.id);
          memoryByUser.get(token.userId)?.delete(token.id);
        } else if (successfulExpoTokens.has(claim.expoToken)) {
          const lastSent = { ...(token.prefs.last_sent ?? {}) };
          for (const item of claim.dedupe) lastSent[item.slot] = item.key;
          token.prefs = { ...token.prefs, last_sent: lastSent };
          memory.set(token.id, token);
        }
      }
      for (const item of claim.dedupe) {
        memoryDeliveryClaims.delete(deliveryKey(claim.tokenId, item.slot, item.key));
      }
    }
  });
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
  memoryDeliveryClaims.clear();
  memoryClaimQueue = Promise.resolve();
  tableReady = false;
  tableInitPromise = null;
  failNextClaimUpsert = false;
}

/** Test-only transaction rollback hook for the Postgres integration suite. */
export function _failNextPushClaimUpsertForTest(): void {
  failNextClaimUpsert = true;
}
