/**
 * Postgres persistence for users + Robinhood MCP credentials.
 * When POSTGRES_URL is unset (local tests), callers fall back to in-memory.
 */
import { SQL } from "bun";
import { postgresUrl } from "./env.js";

let sql: SQL | null = null;
let initPromise: Promise<void> | null = null;

export function dbEnabled(): boolean {
  return Boolean(postgresUrl());
}

export function getSql(): SQL | null {
  return sql;
}

export async function initDb(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const url = postgresUrl();
    if (!url) {
      console.log("[db] POSTGRES_URL unset — using in-memory auth/settings store");
      return;
    }
    sql = new SQL(url);
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT ARRAY['user']::text[]
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS user_robinhood_mcp (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token_ciphertext TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        last4 TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `;
    console.log("[db] postgres ready (users + user_robinhood_mcp)");
  })();
  return initPromise;
}
