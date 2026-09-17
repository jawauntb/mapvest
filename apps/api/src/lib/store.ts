/**
 * User store — Postgres when POSTGRES_URL is set, otherwise in-memory (tests/dev).
 */
import type { User } from "@mapvest/core";
import { dbEnabled, getSql, initDb } from "./db.js";
import { ensureUserEntitlements } from "./entitlements.js";
import { adminEmails, isDev } from "./env.js";
import {
  HANDLE_RENAME_COOLDOWN_MS,
  type RenameHandleResult,
  generateHandle,
  isValidHandleFormat,
} from "./handles.js";

export type { RenameHandleResult } from "./handles.js";

type PendingLink = {
  email: string;
  token: string;
  expiresAt: number; // epoch ms
};

const users = new Map<string, User>(); // id -> user
const byEmail = new Map<string, string>(); // email -> id
const byHandle = new Map<string, string>(); // lower(handle) -> id
const handleUpdatedAtMs = new Map<string, number>(); // id -> epoch ms (memory-mode rename cooldown)
const pending = new Map<string, PendingLink>(); // jti -> pending

function scopesFor(email: string): User["scopes"] {
  const lower = email.toLowerCase();
  if (adminEmails().includes(lower)) return ["user", "admin"];
  return ["user"];
}

function newId(): string {
  return `usr_${crypto.randomUUID().replace(/-/g, "")}`;
}

/** Fresh "finder-<8hex>" handle, retried a few times against this instance's
 * cache. The DB's unique index on lower(handle) is the real backstop — the
 * 32-bit hex space makes an actual collision negligible at this scale. */
function newUniqueHandle(): string {
  for (let i = 0; i < 5; i++) {
    const candidate = generateHandle();
    if (!byHandle.has(candidate.toLowerCase())) return candidate;
  }
  return generateHandle();
}

function cacheUser(user: User) {
  users.set(user.id, user);
  byEmail.set(user.email, user.id);
  if (user.handle) byHandle.set(user.handle.toLowerCase(), user.id);
}

function rowToUser(row: {
  id: string;
  email: string;
  created_at: Date | string;
  scopes: string[] | null;
  handle: string;
}): User {
  const createdAt =
    typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString();
  const scopes = (row.scopes?.length ? row.scopes : scopesFor(row.email)) as User["scopes"];
  return { id: row.id, email: row.email, createdAt, scopes, handle: row.handle };
}

type UserRow = {
  id: string;
  email: string;
  created_at: Date | string;
  scopes: string[] | null;
  handle: string;
};

async function dbGetById(id: string): Promise<User | undefined> {
  const sql = getSql();
  if (!sql) return undefined;
  const rows =
    await sql`SELECT id, email, created_at, scopes, handle FROM users WHERE id = ${id} LIMIT 1`;
  const row = rows[0] as UserRow | undefined;
  if (!row) return undefined;
  const user = rowToUser(row);
  cacheUser(user);
  return user;
}

async function dbGetByEmail(email: string): Promise<User | undefined> {
  const sql = getSql();
  if (!sql) return undefined;
  const rows =
    await sql`SELECT id, email, created_at, scopes, handle FROM users WHERE email = ${email} LIMIT 1`;
  const row = rows[0] as UserRow | undefined;
  if (!row) return undefined;
  const user = rowToUser(row);
  cacheUser(user);
  return user;
}

async function dbUpsert(user: User): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  const created = new Date(user.createdAt);
  const handle = user.handle ?? newUniqueHandle();
  await sql`
    INSERT INTO users (id, email, created_at, scopes, handle)
    VALUES (${user.id}, ${user.email}, ${created}, ${sql.array(user.scopes)}, ${handle})
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      scopes = EXCLUDED.scopes
  `;
}

export async function findOrCreateUserByEmail(emailRaw: string): Promise<User> {
  await initDb();
  const email = emailRaw.toLowerCase().trim();

  const memId = byEmail.get(email);
  if (memId) {
    const u = users.get(memId);
    if (u) {
      await ensureUserEntitlements(u);
      return u;
    }
  }

  if (dbEnabled()) {
    const existing = await dbGetByEmail(email);
    if (existing) {
      // Refresh scopes from admin list on login.
      const scopes = scopesFor(email);
      if (scopes.join(",") !== existing.scopes.join(",")) {
        const updated = { ...existing, scopes };
        cacheUser(updated);
        await dbUpsert(updated);
        await ensureUserEntitlements(updated);
        return updated;
      }
      await ensureUserEntitlements(existing);
      return existing;
    }
  }

  const id = newId();
  const user: User = {
    id,
    email,
    createdAt: new Date().toISOString(),
    scopes: scopesFor(email),
    handle: newUniqueHandle(),
  };
  cacheUser(user);
  if (dbEnabled()) await dbUpsert(user);
  await ensureUserEntitlements(user);
  if (isDev()) console.log(`[auth] created user ${id} <${email}> scopes=${user.scopes.join(",")}`);
  return user;
}

export async function getUserById(id: string): Promise<User | undefined> {
  await initDb();
  const mem = users.get(id);
  if (mem) return mem;
  if (dbEnabled()) return dbGetById(id);
  return undefined;
}

/**
 * Rehydrate a user after process restart when the JWT still carries `sub` + `email`.
 * Upserts into Postgres so subsequent deploys keep the same id.
 */
export async function ensureUser(id: string, emailRaw: string): Promise<User> {
  await initDb();
  const email = emailRaw.toLowerCase().trim();
  const existing = await getUserById(id);
  if (existing) {
    await ensureUserEntitlements(existing);
    return existing;
  }

  if (dbEnabled()) {
    const byMail = await dbGetByEmail(email);
    if (byMail) {
      await ensureUserEntitlements(byMail);
      return byMail;
    }
  } else {
    const byMailId = byEmail.get(email);
    if (byMailId) {
      const u = users.get(byMailId);
      if (u) {
        await ensureUserEntitlements(u);
        return u;
      }
    }
  }

  const user: User = {
    id,
    email,
    createdAt: new Date().toISOString(),
    scopes: scopesFor(email),
    handle: newUniqueHandle(),
  };
  cacheUser(user);
  if (dbEnabled()) await dbUpsert(user);
  await ensureUserEntitlements(user);
  if (isDev()) console.log(`[auth] rehydrated user ${id} <${email}>`);
  return user;
}

export async function listUsers(): Promise<User[]> {
  await initDb();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows =
        await sql`SELECT id, email, created_at, scopes, handle FROM users ORDER BY created_at ASC`;
      const out: User[] = [];
      for (const row of rows as UserRow[]) {
        const u = rowToUser(row);
        cacheUser(u);
        out.push(u);
      }
      return out;
    }
  }
  return [...users.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export function storePendingLink(jti: string, link: PendingLink) {
  pending.set(jti, link);
}

export function consumePendingLink(jti: string): PendingLink | undefined {
  const p = pending.get(jti);
  if (!p) return undefined;
  pending.delete(jti);
  if (p.expiresAt < Date.now()) return undefined;
  return p;
}

async function dbGetHandleUpdatedAt(userId: string): Promise<number | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql`SELECT handle_updated_at FROM users WHERE id = ${userId} LIMIT 1`;
  const row = rows[0] as { handle_updated_at: Date | string | null } | undefined;
  if (!row?.handle_updated_at) return null;
  const d =
    typeof row.handle_updated_at === "string"
      ? new Date(row.handle_updated_at)
      : row.handle_updated_at;
  return d.getTime();
}

const HANDLE_TAKEN_RESULT: RenameHandleResult = {
  ok: false,
  code: "handle_taken",
  error: "That handle is already taken.",
};

/**
 * POST /v1/settings/handle. Validates format, enforces the 24h cooldown, and
 * checks case-insensitive uniqueness before persisting. Errors are distinct
 * per cause (format vs. collision vs. rate limit) so the client never has to
 * guess which one it hit.
 */
export async function renameHandle(
  userId: string,
  nextHandleRaw: string,
): Promise<RenameHandleResult> {
  await initDb();
  const nextHandle = nextHandleRaw.trim().toLowerCase();
  if (!isValidHandleFormat(nextHandle)) {
    return {
      ok: false,
      code: "invalid_format",
      error: "Handles must be 3–20 characters: lowercase letters, numbers, and hyphens only.",
    };
  }

  const user = await getUserById(userId);
  if (!user) {
    return { ok: false, code: "invalid_format", error: "unknown user" };
  }

  const lastRenameMs = dbEnabled()
    ? await dbGetHandleUpdatedAt(userId)
    : (handleUpdatedAtMs.get(userId) ?? null);
  if (lastRenameMs !== null) {
    const elapsedMs = Date.now() - lastRenameMs;
    if (elapsedMs < HANDLE_RENAME_COOLDOWN_MS) {
      return {
        ok: false,
        code: "rate_limited",
        error: "You can rename your handle once every 24 hours.",
        retryAfterSec: Math.ceil((HANDLE_RENAME_COOLDOWN_MS - elapsedMs) / 1000),
      };
    }
  }

  const now = new Date();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const clash = await sql`
        SELECT id FROM users WHERE lower(handle) = ${nextHandle} AND id != ${userId} LIMIT 1
      `;
      if (clash[0]) return HANDLE_TAKEN_RESULT;
      try {
        await sql`
          UPDATE users SET handle = ${nextHandle}, handle_updated_at = ${now} WHERE id = ${userId}
        `;
      } catch {
        // Unique index caught a race the check above missed.
        return HANDLE_TAKEN_RESULT;
      }
    }
  } else {
    const existingOwner = byHandle.get(nextHandle);
    if (existingOwner && existingOwner !== userId) return HANDLE_TAKEN_RESULT;
  }

  if (user.handle) byHandle.delete(user.handle.toLowerCase());
  byHandle.set(nextHandle, userId);
  const updated: User = { ...user, handle: nextHandle };
  users.set(userId, updated);
  handleUpdatedAtMs.set(userId, now.getTime());

  return { ok: true, handle: nextHandle };
}

/** Test-only helper to reset state between suites. */
export function __resetStore() {
  users.clear();
  byEmail.clear();
  byHandle.clear();
  handleUpdatedAtMs.clear();
  pending.clear();
}
