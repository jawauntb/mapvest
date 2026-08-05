/**
 * Postgres persistence: users, Robinhood MCP, nearby geo tiles, brand→ticker.
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
      console.log("[db] POSTGRES_URL unset — using in-memory stores");
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
    await sql`
      CREATE TABLE IF NOT EXISTS nearby_cache (
        cache_key TEXT PRIMARY KEY,
        geohash TEXT NOT NULL,
        lat_center DOUBLE PRECISION NOT NULL,
        lng_center DOUBLE PRECISION NOT NULL,
        radius_m INTEGER NOT NULL,
        source TEXT NOT NULL,
        payload JSONB NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS nearby_cache_expires_idx ON nearby_cache (expires_at)`;
    await sql`CREATE INDEX IF NOT EXISTS nearby_cache_geohash_idx ON nearby_cache (geohash)`;
    await sql`
      CREATE TABLE IF NOT EXISTS brand_ticker_cache (
        brand_key TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS brand_ticker_cache_expires_idx ON brand_ticker_cache (expires_at)`;
    console.log("[db] postgres ready (users, mcp, nearby_cache, brand_ticker_cache)");
  })();
  return initPromise;
}
