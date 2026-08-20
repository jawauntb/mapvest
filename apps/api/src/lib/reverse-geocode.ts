/**
 * Minimal reverse-geocode → short place label (Universe Roadmap §1 A2).
 *
 * A find's push copy has to be *spatial*: "The Chipotle you spotted near
 * Valencia St is up 26% since you found it". That needs one short human label
 * for a lat/lng — not the full `GeoPlace` that `local-brief-generator.ts`
 * builds for the Local Economy Brief.
 *
 * `local-brief-generator.ts` already talks to Nominatim (zoom 16,
 * suburb/neighbourhood scope) but does not export its `reverseGeocode`, so
 * this file re-states the *minimum* of that call in the same style: same
 * courtesy User-Agent (Nominatim's usage policy requires a real identifying
 * agent), one request, short timeout, in-memory cache.
 *
 * Contract:
 * - Never throws. Any failure (network, non-2xx, bad JSON, abort, no usable
 *   address field) resolves to `null` — the caller drops the place clause and
 *   falls back to non-spatial copy. We never guess a street name.
 * - Cached by lat/lng rounded to 3 decimals (~110 m), which is exactly the
 *   granularity a "near X" label carries. Negative results are cached too, so
 *   a dead cell costs one request per TTL, not one per scan tick.
 * - Cache is capped at 500 entries, evicting oldest-inserted first.
 */

/** Nominatim address subset we actually read. */
export type ReverseGeocodeAddress = {
  suburb?: string;
  neighbourhood?: string;
  road?: string;
};

type NominatimReverseResponse = { address?: ReverseGeocodeAddress };

/** Nominatim usage policy: identify the app with a contactable User-Agent. */
const USER_AGENT = "mapvest/0.1 (support@mapvest.app)";
/** Push copy is composed inside a scheduler tick — a slow cell must not hold it. */
const TIMEOUT_MS = 5_000;
/** Same 24h horizon the Local Brief uses; street names do not move. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Hard ceiling on cache footprint. Oldest-inserted entry is evicted first. */
export const REVERSE_GEOCODE_CACHE_MAX = 500;
/** Longest label we will put in a push body — anything longer reads as noise. */
const MAX_LABEL_LENGTH = 48;

type CacheEntry = { expiresAt: number; label: string | null };

const cache = new Map<string, CacheEntry>();

/** Cache key: lat/lng rounded to 3 decimals (~110 m). Pure. */
export function reverseGeocodeKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/**
 * Short place label from a Nominatim address: suburb, else neighbourhood,
 * else road — first non-empty wins. Pure, so the copy path is assertable
 * offline. Returns `null` when nothing usable is present, and refuses labels
 * long enough to swamp a notification body.
 */
export function placeLabelFromAddress(address: ReverseGeocodeAddress | undefined): string | null {
  if (!address) return null;
  for (const candidate of [address.suburb, address.neighbourhood, address.road]) {
    const label = typeof candidate === "string" ? candidate.trim() : "";
    if (label.length === 0) continue;
    if (label.length > MAX_LABEL_LENGTH) continue;
    return label;
  }
  return null;
}

/** Test-only. Public callers should not reach in. */
export function _clearReverseGeocodeCache(): void {
  cache.clear();
}

/** Test-only. Number of live (not necessarily unexpired) cache entries. */
export function _reverseGeocodeCacheSize(): number {
  return cache.size;
}

/**
 * Cache peek. `undefined` means "not cached" (a network call would be needed);
 * `string | null` is a cached hit, including a cached miss. Synchronous and
 * free, so a caller with a per-tick network budget can serve cached cells
 * without spending any of it.
 */
export function cachedPlaceLabel(lat: number, lng: number): string | null | undefined {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const hit = cache.get(reverseGeocodeKey(lat, lng));
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(reverseGeocodeKey(lat, lng));
    return undefined;
  }
  return hit.label;
}

/** Insert with an oldest-first eviction once the cap is reached. */
export function _cachePlaceLabel(lat: number, lng: number, label: string | null): void {
  const key = reverseGeocodeKey(lat, lng);
  // Re-inserting refreshes recency: delete first so the key moves to the end
  // of the Map's insertion order.
  cache.delete(key);
  while (cache.size >= REVERSE_GEOCODE_CACHE_MAX) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  cache.set(key, { label, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Short place label for a lat/lng, cache-first. Never throws — `null` on any
 * failure, on out-of-range coordinates, and when the address carries no
 * usable suburb / neighbourhood / road.
 */
export async function reverseGeocodePlaceLabel(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const cached = cachedPlaceLabel(lat, lng);
  if (cached !== undefined) return cached;

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "json");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("zoom", "16");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const body = (await res.json()) as NominatimReverseResponse;
    const label = placeLabelFromAddress(body.address);
    _cachePlaceLabel(lat, lng, label);
    return label;
  } catch {
    // Silent by contract: a missing place label degrades the copy, it never
    // fails the push. Cache the miss so one dead cell costs one request.
    _cachePlaceLabel(lat, lng, null);
    return null;
  }
}
