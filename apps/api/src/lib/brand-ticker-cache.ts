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

/**
 * Batched cache read — one `WHERE brand_key = ANY(...)` round-trip instead of
 * N single-row lookups. Callers that need to resolve a whole page of place
 * names (e.g. /v1/nearby) should use this instead of looping
 * `readBrandTickerCache` per name.
 *
 * Returns a Map keyed by the *original* input name (not the normalized
 * brand_key) so callers can look up hits by the name they already have.
 * Names that miss the cache (or dedupe to the same key) are simply absent
 * from the map — same "null means miss" contract as the single-name reader.
 */
export async function readBrandTickerCacheMany(
  names: string[],
): Promise<Map<string, { brand: Brand; sources: Source[] }>> {
  const result = new Map<string, { brand: Brand; sources: Source[] }>();
  if (names.length === 0) return result;
  await initDb();
  if (!dbEnabled()) return result;
  const sql = getSql();
  if (!sql) return result;

  const keyToNames = new Map<string, string[]>();
  for (const name of names) {
    const key = brandKey(name);
    const bucket = keyToNames.get(key);
    if (bucket) bucket.push(name);
    else keyToNames.set(key, [name]);
  }
  const keys = [...keyToNames.keys()];

  const rows = await sql`
    SELECT brand_key, payload
    FROM brand_ticker_cache
    WHERE brand_key = ANY(${sql.array(keys)})
      AND expires_at > now()
  `;
  for (const row of rows as Array<{
    brand_key: string;
    payload: { brand: Brand; sources: Source[] };
  }>) {
    if (!row?.payload?.brand) continue;
    const originalNames = keyToNames.get(row.brand_key);
    if (!originalNames) continue;
    for (const name of originalNames) {
      result.set(name, row.payload);
    }
  }
  return result;
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
