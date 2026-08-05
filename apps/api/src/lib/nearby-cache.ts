import { dbEnabled, getSql, initDb } from "./db.js";
import { nearbyCacheKey } from "./geohash.js";

export type CachedPlacesPayload = {
  results: Array<{
    place_id: string;
    name: string;
    geometry: { location: { lat: number; lng: number } };
    types?: string[];
    vicinity?: string;
  }>;
};

const TTL_MS = 12 * 60 * 60 * 1000; // 12h

export async function readNearbyPlacesCache(
  lat: number,
  lng: number,
  radius: number,
): Promise<{ payload: CachedPlacesPayload; source: string; cacheKey: string } | null> {
  await initDb();
  if (!dbEnabled()) return null;
  const sql = getSql();
  if (!sql) return null;
  const { cacheKey } = nearbyCacheKey(lat, lng, radius);
  const rows = await sql`
    SELECT payload, source
    FROM nearby_cache
    WHERE cache_key = ${cacheKey}
      AND expires_at > now()
    LIMIT 1
  `;
  const row = rows[0] as { payload: CachedPlacesPayload; source: string } | undefined;
  if (!row?.payload?.results) return null;
  return { payload: row.payload, source: row.source, cacheKey };
}

export async function writeNearbyPlacesCache(args: {
  lat: number;
  lng: number;
  radius: number;
  source: string;
  payload: CachedPlacesPayload;
}): Promise<void> {
  await initDb();
  if (!dbEnabled()) return;
  const sql = getSql();
  if (!sql) return;
  const { cacheKey, geohash, radiusBucket } = nearbyCacheKey(args.lat, args.lng, args.radius);
  const expires = new Date(Date.now() + TTL_MS);
  const payloadJson = JSON.stringify(args.payload);
  await sql`
    INSERT INTO nearby_cache (
      cache_key, geohash, lat_center, lng_center, radius_m, source, payload, fetched_at, expires_at
    )
    VALUES (
      ${cacheKey},
      ${geohash},
      ${args.lat},
      ${args.lng},
      ${radiusBucket},
      ${args.source},
      ${payloadJson}::jsonb,
      now(),
      ${expires}
    )
    ON CONFLICT (cache_key) DO UPDATE SET
      source = EXCLUDED.source,
      payload = EXCLUDED.payload,
      lat_center = EXCLUDED.lat_center,
      lng_center = EXCLUDED.lng_center,
      fetched_at = EXCLUDED.fetched_at,
      expires_at = EXCLUDED.expires_at
  `;
}
