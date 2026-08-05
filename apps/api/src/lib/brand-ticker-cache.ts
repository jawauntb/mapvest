import type { Brand, Source } from "@mapvest/core";
import { dbEnabled, getSql, initDb } from "./db.js";

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d — brand→ticker is stable

function brandKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

export async function readBrandTickerCache(
  name: string,
): Promise<{ brand: Brand; sources: Source[] } | null> {
  await initDb();
  if (!dbEnabled()) return null;
  const sql = getSql();
  if (!sql) return null;
  const key = brandKey(name);
  const rows = await sql`
    SELECT payload
    FROM brand_ticker_cache
    WHERE brand_key = ${key}
      AND expires_at > now()
    LIMIT 1
  `;
  const row = rows[0] as { payload: { brand: Brand; sources: Source[] } } | undefined;
  if (!row?.payload?.brand) return null;
  return row.payload;
}

export async function writeBrandTickerCache(
  name: string,
  brand: Brand,
  sources: Source[],
): Promise<void> {
  await initDb();
  if (!dbEnabled()) return;
  const sql = getSql();
  if (!sql) return;
  const key = brandKey(name);
  const expires = new Date(Date.now() + TTL_MS);
  const payloadJson = JSON.stringify({ brand, sources });
  await sql`
    INSERT INTO brand_ticker_cache (brand_key, payload, fetched_at, expires_at)
    VALUES (${key}, ${payloadJson}::jsonb, now(), ${expires})
    ON CONFLICT (brand_key) DO UPDATE SET
      payload = EXCLUDED.payload,
      fetched_at = EXCLUDED.fetched_at,
      expires_at = EXCLUDED.expires_at
  `;
}
