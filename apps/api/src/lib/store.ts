/**
 * User store — Postgres when POSTGRES_URL is set, otherwise in-memory (tests/dev).
 */
import type { User } from "@mapvest/core";
import { dbEnabled, getSql, initDb } from "./db.js";
import { ensureUserEntitlements } from "./entitlements.js";
import { adminEmails, isDev } from "./env.js";

type PendingLink = {
  email: string;
  token: string;
  expiresAt: number; // epoch ms
};

const users = new Map<string, User>(); // id -> user
const byEmail = new Map<string, string>(); // email -> id
const pending = new Map<string, PendingLink>(); // jti -> pending

function scopesFor(email: string): User["scopes"] {
  const lower = email.toLowerCase();
  if (adminEmails().includes(lower)) return ["user", "admin"];
  return ["user"];
}

function newId(): string {
  return `usr_${crypto.randomUUID().replace(/-/g, "")}`;
}

function cacheUser(user: User) {
  users.set(user.id, user);
  byEmail.set(user.email, user.id);
}

function rowToUser(row: {
  id: string;
  email: string;
  created_at: Date | string;
  scopes: string[] | null;
}): User {
  const createdAt =
    typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString();
  const scopes = (row.scopes?.length ? row.scopes : scopesFor(row.email)) as User["scopes"];
  return { id: row.id, email: row.email, createdAt, scopes };
}

async function dbGetById(id: string): Promise<User | undefined> {
  const sql = getSql();
  if (!sql) return undefined;
  const rows = await sql`SELECT id, email, created_at, scopes FROM users WHERE id = ${id} LIMIT 1`;
  const row = rows[0] as
    | { id: string; email: string; created_at: Date | string; scopes: string[] | null }
    | undefined;
  if (!row) return undefined;
  const user = rowToUser(row);
  cacheUser(user);
  return user;
}

async function dbGetByEmail(email: string): Promise<User | undefined> {
  const sql = getSql();
  if (!sql) return undefined;
  const rows =
    await sql`SELECT id, email, created_at, scopes FROM users WHERE email = ${email} LIMIT 1`;
  const row = rows[0] as
    | { id: string; email: string; created_at: Date | string; scopes: string[] | null }
    | undefined;
  if (!row) return undefined;
  const user = rowToUser(row);
  cacheUser(user);
  return user;
}

async function dbUpsert(user: User): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  const created = new Date(user.createdAt);
  await sql`
    INSERT INTO users (id, email, created_at, scopes)
    VALUES (${user.id}, ${user.email}, ${created}, ${sql.array(user.scopes)})
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
        await sql`SELECT id, email, created_at, scopes FROM users ORDER BY created_at ASC`;
      const out: User[] = [];
      for (const row of rows as Array<{
        id: string;
        email: string;
        created_at: Date | string;
        scopes: string[] | null;
      }>) {
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

/** Test-only helper to reset state between suites. */
export function __resetStore() {
  users.clear();
  byEmail.clear();
  pending.clear();
}
