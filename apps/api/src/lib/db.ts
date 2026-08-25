/**
 * Postgres persistence: users, Robinhood MCP, nearby geo tiles, brand→ticker,
 * and owner-scoped research conversation references.
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
    // Phase 8 Slice C+D — entitlements/billing columns. `plan` mirrors
    // IMPLEMENTATION_PLAN.md's union: 'none' | 'free_trial' | 'free_forever' | 'subscribed'.
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'none'`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS free_forever BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS free_forever_reason TEXT`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_original_transaction_id TEXT`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_apple_original_txn_idx
      ON users (apple_original_transaction_id)
      WHERE apple_original_transaction_id IS NOT NULL`;
    await sql`
      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        device_id TEXT,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        kind TEXT NOT NULL,
        request_key TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS request_key TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS usage_events_user_idx ON usage_events (user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS usage_events_device_idx ON usage_events (device_id)`;
    await sql`CREATE INDEX IF NOT EXISTS usage_events_created_idx ON usage_events (created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS usage_events_request_key_idx
      ON usage_events (user_id, device_id, kind, request_key)
      WHERE request_key IS NOT NULL`;
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
    await sql`
      CREATE TABLE IF NOT EXISTS research_conversations (
        conversation_id TEXT PRIMARY KEY,
        owner_key TEXT NOT NULL,
        title TEXT NOT NULL,
        preview TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS research_conversations_owner_idx
      ON research_conversations (owner_key, updated_at DESC)`;
    await sql`
      CREATE TABLE IF NOT EXISTS user_watchlist (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ticker TEXT NOT NULL,
        name TEXT,
        sector TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        memo TEXT,
        memo_provider TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, ticker)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS user_watchlist_user_idx ON user_watchlist (user_id, created_at DESC)`;
    console.log(
      "[db] postgres ready (users, mcp, nearby_cache, brand_ticker_cache, research_conversations, usage_events, watchlist)",
    );
  })();
  return initPromise;
}
