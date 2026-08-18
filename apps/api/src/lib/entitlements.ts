/**
 * Phase 8 Slice C+D — entitlements + the 50-generation free-tier meter shared
 * by /v1/identify, /v1/agent/chat, and /v1/memo (see IMPLEMENTATION_PLAN.md).
 *
 * Postgres-backed (`users.free_forever*` / `users.plan` / `usage_events`)
 * when POSTGRES_URL is set; falls back to an in-process store otherwise so
 * local dev and unit tests don't need a live database.
 *
 * Product rules:
 *   - Anonymous (X-Device-Id only) and signed-in-but-unentitled users get
 *     FREE_GENERATION_LIMIT lifetime generations, counted per identity.
 *   - free_forever (auto: email contains "jawaun"; or admin scope; or a
 *     manual admin grant) and subscribed users are unlimited.
 *   - Only signed-in users (userId present) can persist (save/watchlist) —
 *     that's independent of quota, hence `canPersist` is its own field.
 */
import type { User } from "@mapvest/core";
import { dbEnabled, getSql, initDb } from "./db.js";

export const FREE_GENERATION_LIMIT = 50;
/** Mapvest Pro list price. Native IAP/Play products must match this. */
export const MONTHLY_PRICE_USD = 20;

export type Plan = "none" | "free_trial" | "free_forever" | "subscribed";

export type EntitlementState = {
  plan: Plan;
  remaining: number;
  limit: number;
  freeForever: boolean;
  subscribed: boolean;
  canGenerate: boolean;
  canPersist: boolean;
};

type EntitlementRow = {
  plan: Plan;
  freeForever: boolean;
  freeForeverReason: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  appleOriginalTransactionId: string | null;
};

const DEFAULT_ROW: EntitlementRow = {
  plan: "none",
  freeForever: false,
  freeForeverReason: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  appleOriginalTransactionId: null,
};

/** Internal engineering + friends get unlimited, unbilled usage. */
export function isEmailFreeForever(email: string): boolean {
  return email.toLowerCase().includes("jawaun");
}

// ---- in-memory fallback (POSTGRES_URL unset: local dev + unit tests) ----

const memRows = new Map<string, EntitlementRow>(); // userId -> row
type UsageEvent = {
  deviceId: string | null;
  userId: string | null;
  kind: string;
  createdAt: number;
};
const memEvents: UsageEvent[] = [];

function memGetRow(userId: string): EntitlementRow {
  return memRows.get(userId) ?? DEFAULT_ROW;
}

function memSetFreeForever(userId: string, freeForever: boolean, reason: string | null): void {
  const existing = memGetRow(userId);
  memRows.set(userId, {
    ...existing,
    freeForever,
    freeForeverReason: reason,
    plan: freeForever ? "free_forever" : existing.plan === "free_forever" ? "none" : existing.plan,
  });
}

function memCountEvents(userId?: string, deviceId?: string): number {
  if (userId) return memEvents.filter((e) => e.userId === userId).length;
  if (deviceId) return memEvents.filter((e) => e.deviceId === deviceId && !e.userId).length;
  return 0;
}

// ---- Postgres-backed helpers ----

type UsersEntitlementRow = {
  plan: string | null;
  free_forever: boolean | null;
  free_forever_reason: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  apple_original_transaction_id: string | null;
};

async function dbGetRow(userId: string): Promise<EntitlementRow | undefined> {
  const sql = getSql();
  if (!sql) return undefined;
  const rows = await sql`
    SELECT plan, free_forever, free_forever_reason, stripe_customer_id, stripe_subscription_id,
           apple_original_transaction_id
    FROM users WHERE id = ${userId} LIMIT 1
  `;
  const row = rows[0] as UsersEntitlementRow | undefined;
  if (!row) return undefined;
  return {
    plan: (row.plan as Plan | null) ?? "none",
    freeForever: Boolean(row.free_forever),
    freeForeverReason: row.free_forever_reason,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    appleOriginalTransactionId: row.apple_original_transaction_id,
  };
}

async function dbSetFreeForever(
  userId: string,
  freeForever: boolean,
  reason: string | null,
): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  await sql`
    UPDATE users SET
      free_forever = ${freeForever},
      free_forever_reason = ${reason},
      plan = CASE
        WHEN ${freeForever} THEN 'free_forever'
        WHEN plan = 'free_forever' THEN 'none'
        ELSE plan
      END
    WHERE id = ${userId}
  `;
}

async function dbCountEvents(params: { userId?: string; deviceId?: string }): Promise<number> {
  const sql = getSql();
  if (!sql) return 0;
  const { userId, deviceId } = params;
  if (userId) {
    const rows = await sql`SELECT count(*)::int AS n FROM usage_events WHERE user_id = ${userId}`;
    return Number((rows[0] as { n: number } | undefined)?.n ?? 0);
  }
  if (deviceId) {
    const rows = await sql`
      SELECT count(*)::int AS n FROM usage_events WHERE device_id = ${deviceId} AND user_id IS NULL
    `;
    return Number((rows[0] as { n: number } | undefined)?.n ?? 0);
  }
  return 0;
}

async function dbInsertEvent(params: {
  userId?: string;
  deviceId?: string;
  kind: string;
}): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  const id = `evt_${crypto.randomUUID().replace(/-/g, "")}`;
  await sql`
    INSERT INTO usage_events (id, device_id, user_id, kind, created_at)
    VALUES (${id}, ${params.deviceId ?? null}, ${params.userId ?? null}, ${params.kind}, now())
  `;
}

// ---- public API ----

/**
 * Called from `findOrCreateUserByEmail` / `ensureUser` on every login /
 * rehydration. Grants free_forever to jawaun-matched emails and
 * admin-scoped users. Idempotent — never touches a row that's already
 * free_forever (so it won't clobber a reason set by a manual admin grant).
 */
export async function ensureUserEntitlements(user: User): Promise<void> {
  await initDb();
  const autoFree = isEmailFreeForever(user.email) || Boolean(user.scopes?.includes("admin"));
  if (!autoFree) return;

  const existing = dbEnabled() ? await dbGetRow(user.id) : memGetRow(user.id);
  if (existing?.freeForever) return;

  const reason = isEmailFreeForever(user.email) ? "email match: jawaun" : "admin scope";
  if (dbEnabled()) {
    await dbSetFreeForever(user.id, true, reason);
  } else {
    memSetFreeForever(user.id, true, reason);
  }
}

/**
 * POST /v1/admin/users/:id/entitlement — explicit override. Independent of
 * the automatic jawaun/admin grant in `ensureUserEntitlements` above.
 */
export async function setFreeForever(
  userId: string,
  freeForever: boolean,
  reason?: string,
): Promise<void> {
  await initDb();
  if (dbEnabled()) {
    await dbSetFreeForever(userId, freeForever, reason ?? null);
  } else {
    memSetFreeForever(userId, freeForever, reason ?? null);
  }
}

/**
 * Resolves the caller's entitlement + remaining free-tier quota. At least
 * one of `userId` / `deviceId` should be supplied by callers (the
 * `requireGenerationQuota` middleware enforces this); with neither, usage
 * can't be tracked and this returns a full, unspent quota.
 */
export async function getEntitlementState(params: {
  userId?: string;
  deviceId?: string;
  email?: string;
}): Promise<EntitlementState> {
  await initDb();
  const { userId, deviceId, email } = params;

  const row = userId ? (dbEnabled() ? await dbGetRow(userId) : memGetRow(userId)) : undefined;
  const freeForever = Boolean(row?.freeForever) || (email ? isEmailFreeForever(email) : false);
  const plan: Plan = freeForever ? "free_forever" : (row?.plan ?? "none");
  const subscribed =
    plan === "subscribed" ||
    Boolean(row?.stripeSubscriptionId) ||
    Boolean(row?.appleOriginalTransactionId);

  const limit = FREE_GENERATION_LIMIT;
  if (freeForever || subscribed) {
    return {
      plan,
      remaining: limit,
      limit,
      freeForever,
      subscribed,
      canGenerate: true,
      canPersist: Boolean(userId),
    };
  }

  const used = dbEnabled()
    ? await dbCountEvents({ userId, deviceId })
    : memCountEvents(userId, deviceId);
  const remaining = Math.max(0, limit - used);
  return {
    plan,
    remaining,
    limit,
    freeForever,
    subscribed,
    canGenerate: remaining > 0,
    canPersist: Boolean(userId),
  };
}

/** Records one billable generation (identify / agent_chat / memo) for metering. */
export async function recordGeneration(params: {
  userId?: string;
  deviceId?: string;
  kind: string;
}): Promise<void> {
  await initDb();
  if (dbEnabled()) {
    await dbInsertEvent(params);
  } else {
    memEvents.push({
      userId: params.userId ?? null,
      deviceId: params.deviceId ?? null,
      kind: params.kind,
      createdAt: Date.now(),
    });
  }
}

// ---- Stripe subscription helpers (Phase 8 Slice E) ----

type SubscriptionPatch = {
  plan?: Plan;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  appleOriginalTransactionId?: string | null;
};

function memSetSubscription(userId: string, patch: SubscriptionPatch): void {
  const existing = memGetRow(userId);
  memRows.set(userId, { ...existing, ...patch });
}

async function dbSetSubscription(userId: string, patch: SubscriptionPatch): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  // Only overwrite columns the caller actually passed — `undefined` means "leave as-is".
  if (patch.plan !== undefined) {
    await sql`UPDATE users SET plan = ${patch.plan} WHERE id = ${userId}`;
  }
  if (patch.stripeCustomerId !== undefined) {
    await sql`UPDATE users SET stripe_customer_id = ${patch.stripeCustomerId} WHERE id = ${userId}`;
  }
  if (patch.stripeSubscriptionId !== undefined) {
    await sql`UPDATE users SET stripe_subscription_id = ${patch.stripeSubscriptionId} WHERE id = ${userId}`;
  }
  if (patch.appleOriginalTransactionId !== undefined) {
    await sql`UPDATE users SET apple_original_transaction_id = ${patch.appleOriginalTransactionId} WHERE id = ${userId}`;
  }
}

/** Reads just the Stripe customer id (used by `/v1/billing/portal`). */
export async function getStripeCustomerId(userId: string): Promise<string | null> {
  await initDb();
  const row = dbEnabled() ? await dbGetRow(userId) : memGetRow(userId);
  return row?.stripeCustomerId ?? null;
}

/**
 * POST /v1/billing/webhook — `checkout.session.completed` and
 * `customer.subscription.updated` (status active/trialing) land here.
 * Flips `plan` to `subscribed` and records the Stripe ids. Never touches
 * `free_forever` — a free-forever user who also subscribes keeps that flag
 * (harmless: `getEntitlementState` already treats free_forever as the
 * highest-priority unlimited state).
 */
export async function markSubscribed(
  userId: string,
  ids: { stripeCustomerId: string; stripeSubscriptionId: string },
): Promise<void> {
  await initDb();
  const patch = {
    plan: "subscribed" as Plan,
    stripeCustomerId: ids.stripeCustomerId,
    stripeSubscriptionId: ids.stripeSubscriptionId,
  };
  if (dbEnabled()) {
    await dbSetSubscription(userId, patch);
  } else {
    memSetSubscription(userId, patch);
  }
}

/**
 * `customer.subscription.deleted` (or updated to a canceled/unpaid status)
 * — drops the user back to the free-tier meter. Keeps `stripe_customer_id`
 * so a future checkout/portal call reuses the same Stripe customer; clears
 * `stripe_subscription_id` since it's no longer active. Leaves
 * `free_forever` untouched.
 */
export async function clearSubscription(userId: string): Promise<void> {
  await initDb();
  const row = dbEnabled() ? await dbGetRow(userId) : memGetRow(userId);
  const nextPlan: Plan = row?.freeForever ? "free_forever" : "none";
  const patch = { plan: nextPlan, stripeSubscriptionId: null };
  if (dbEnabled()) {
    await dbSetSubscription(userId, patch);
  } else {
    memSetSubscription(userId, patch);
  }
}

/**
 * Resolves a Mapvest user id from a Stripe customer id — the webhook's
 * fallback path when a `customer.subscription.*` event's metadata lacks
 * `userId` (e.g. subscription created directly in the Stripe dashboard).
 */
export async function findUserIdByStripeCustomerId(customerId: string): Promise<string | null> {
  await initDb();
  if (dbEnabled()) {
    const sql = getSql();
    if (!sql) return null;
    const rows = await sql`SELECT id FROM users WHERE stripe_customer_id = ${customerId} LIMIT 1`;
    return (rows[0] as { id: string } | undefined)?.id ?? null;
  }
  for (const [userId, row] of memRows.entries()) {
    if (row.stripeCustomerId === customerId) return userId;
  }
  return null;
}

export class AppleSubscriptionConflictError extends Error {
  constructor(message = "apple transaction already bound to another account") {
    super(message);
    this.name = "AppleSubscriptionConflictError";
  }
}

export async function findUserIdByAppleOriginalTransactionId(
  originalTransactionId: string,
): Promise<string | null> {
  await initDb();
  if (dbEnabled()) {
    const sql = getSql();
    if (!sql) return null;
    const rows = await sql`
      SELECT id FROM users WHERE apple_original_transaction_id = ${originalTransactionId} LIMIT 1
    `;
    return (rows[0] as { id: string } | undefined)?.id ?? null;
  }
  for (const [userId, row] of memRows.entries()) {
    if (row.appleOriginalTransactionId === originalTransactionId) return userId;
  }
  return null;
}

/**
 * StoreKit 2 purchase/restore — binds this Apple originalTransactionId to the
 * Mapvest user and flips `plan` to `subscribed`. Does not touch Stripe ids.
 */
export async function markAppleSubscribed(
  userId: string,
  originalTransactionId: string,
): Promise<void> {
  await initDb();
  const existing = await findUserIdByAppleOriginalTransactionId(originalTransactionId);
  if (existing && existing !== userId) {
    throw new AppleSubscriptionConflictError();
  }
  const patch: SubscriptionPatch = {
    plan: "subscribed",
    appleOriginalTransactionId: originalTransactionId,
  };
  if (dbEnabled()) {
    await dbSetSubscription(userId, patch);
  } else {
    memSetSubscription(userId, patch);
  }
}

/**
 * Apple subscription expired or revoked. Clears the Apple transaction id.
 * Drops `plan` back to free_forever/none only when there is no Stripe sub.
 */
export async function clearAppleSubscription(userId: string): Promise<void> {
  await initDb();
  const row = dbEnabled() ? await dbGetRow(userId) : memGetRow(userId);
  const stillStripe = Boolean(row?.stripeSubscriptionId);
  const nextPlan: Plan = stillStripe ? "subscribed" : row?.freeForever ? "free_forever" : "none";
  const patch: SubscriptionPatch = {
    plan: nextPlan,
    appleOriginalTransactionId: null,
  };
  if (dbEnabled()) {
    await dbSetSubscription(userId, patch);
  } else {
    memSetSubscription(userId, patch);
  }
}

/** Test-only helper to reset in-memory state between suites. */
export function __resetEntitlements(): void {
  memRows.clear();
  memEvents.length = 0;
}
