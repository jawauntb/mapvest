/**
 * In-memory user + pending-magic-link store.
 *
 * A Postgres backend is stubbed via `postgresUrl()` — when set we log a note so
 * ops know they need to swap this out before persistence matters. For v0 the
 * in-memory store is enough to make magic-link auth work end-to-end in a single
 * process (which is what our Railway service is).
 */
import type { User } from "@mapvest/core";
import { adminEmails, isDev, postgresUrl } from "./env.js";

type PendingLink = {
  email: string;
  token: string;
  expiresAt: number; // epoch ms
};

const users = new Map<string, User>(); // id -> user
const byEmail = new Map<string, string>(); // email -> id
const pending = new Map<string, PendingLink>(); // jti -> pending

let postgresNoted = false;
function notePostgresIfSet() {
  if (postgresNoted) return;
  if (postgresUrl()) {
    console.warn(
      "[auth] POSTGRES_URL is set but the Postgres session store is not implemented in v0 — falling back to in-memory.",
    );
  }
  postgresNoted = true;
}

function scopesFor(email: string): User["scopes"] {
  const lower = email.toLowerCase();
  if (adminEmails().includes(lower)) return ["user", "admin"];
  return ["user"];
}

function newId(): string {
  return `usr_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function findOrCreateUserByEmail(emailRaw: string): User {
  notePostgresIfSet();
  const email = emailRaw.toLowerCase().trim();
  const existingId = byEmail.get(email);
  if (existingId) {
    const u = users.get(existingId);
    if (u) return u;
  }
  const id = newId();
  const user: User = {
    id,
    email,
    createdAt: new Date().toISOString(),
    scopes: scopesFor(email),
  };
  users.set(id, user);
  byEmail.set(email, id);
  if (isDev()) console.log(`[auth] created user ${id} <${email}> scopes=${user.scopes.join(",")}`);
  return user;
}

export function getUserById(id: string): User | undefined {
  return users.get(id);
}

/**
 * Rehydrate a user after in-memory store wipe (API restart) when the JWT still
 * carries a stable `sub` + `email`. Keeps Save/watchlist working across deploys.
 */
export function ensureUser(id: string, emailRaw: string): User {
  notePostgresIfSet();
  const email = emailRaw.toLowerCase().trim();
  const existing = users.get(id);
  if (existing) return existing;
  // Prefer existing email→id mapping if somehow out of sync.
  const byMail = byEmail.get(email);
  if (byMail) {
    const u = users.get(byMail);
    if (u) return u;
  }
  const user: User = {
    id,
    email,
    createdAt: new Date().toISOString(),
    scopes: scopesFor(email),
  };
  users.set(id, user);
  byEmail.set(email, id);
  if (isDev()) console.log(`[auth] rehydrated user ${id} <${email}>`);
  return user;
}

export function listUsers(): User[] {
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
  postgresNoted = false;
}
