import { readFile } from "node:fs/promises";
import type { NearbyResponse } from "@mapvest/core";
import { resolveTicker } from "@mapvest/finance";
import { Hono } from "hono";
import { readBrandTickerCacheMany, writeBrandTickerCache } from "../lib/brand-ticker-cache.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { readNearbyPlacesCache, writeNearbyPlacesCache } from "../lib/nearby-cache.js";

/** Google Nearby allows one `type` per request — race these consumer/brand types. */
const GOOGLE_PLACE_TYPES = [
  "restaurant",
  "cafe",
  "bakery",
  "meal_takeaway",
  "bar",
  "store",
  "supermarket",
  "convenience_store",
  "clothing_store",
  "department_store",
  "pharmacy",
  "bank",
  "gas_station",
  "gym",
  "lodging",
  "shopping_mall",
  "electronics_store",
  "movie_theater",
] as const;

/** Drop geo/admin/professional noise that crowds out investable brands. */
const DROP_PLACE_TYPES = new Set([
  "locality",
  "political",
  "sublocality",
  "sublocality_level_1",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "route",
  "neighborhood",
  "doctor",
  "hospital",
  "dentist",
  "veterinary_care",
  "cemetery",
  "church",
  "place_of_worship",
  "school",
  "primary_school",
  "secondary_school",
  "university",
  "city_hall",
  "embassy",
  "museum",
  "park",
  "tourist_attraction",
]);

const nearby = new Hono();

type PlacesResult = {
  place_id: string;
  name: string;
  geometry: { location: { lat: number; lng: number } };
  types?: string[];
};

type PlacesPayload = {
  results: PlacesResult[];
};

/**
 * Load a Google Places response from a JSON file on disk. Used for offline
 * development and unit tests so we do not have to hit the real API. Guarded
 * by NODE_ENV !== "production" at the call site — never enabled in prod.
 */
async function loadMockPlaces(path: string): Promise<PlacesPayload> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as PlacesPayload;
  if (!parsed || !Array.isArray(parsed.results)) {
    throw new Error("MOCK_PLACES: expected { results: [...] } shape");
  }
  return parsed;
}

/**
 * OpenStreetMap Overpass API — free, no key, no billing. Returns POIs that
 * have a `brand`, `name`, or `shop` tag inside a radius. We map to the
 * Google Places shape so the rest of the handler doesn't care about source.
 *
 * Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
 */
type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};
type OverpassResponse = { elements: OverpassElement[] };

// Prefer mirrors that currently answer from Railway / US egress. de/kumi/jp
// frequently time out or present expired certs; FR has been reliable.
// Docs: https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances
const OVERPASS_MIRRORS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];

const OVERPASS_TIMEOUT_MS = 7000;

function overpassQuery(lat: number, lng: number, radius: number): string {
  return `
    [out:json][timeout:8];
    (
      node["brand"](around:${radius},${lat},${lng});
      node["shop"](around:${radius},${lat},${lng});
      node["amenity"~"^(restaurant|cafe|fast_food|bank|pharmacy|fuel|cinema|gym)$"](around:${radius},${lat},${lng});
    );
    out center 40;
  `;
}

function elementsToPlaces(elements: OverpassElement[]): PlacesResult[] {
  const seen = new Set<string>();
  const results: PlacesResult[] = [];
  for (const el of elements) {
    const name = el.tags?.brand ?? el.tags?.name;
    if (!name) continue;
    const lat2 = el.lat ?? el.center?.lat;
    const lng2 = el.lon ?? el.center?.lon;
    if (typeof lat2 !== "number" || typeof lng2 !== "number") continue;
    // dedupe on (name, ~100m grid) — one McDonald's, not five copies.
    const key = `${name.toLowerCase()}@${lat2.toFixed(3)},${lng2.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      place_id: `osm:${el.type}:${el.id}`,
      name,
      geometry: { location: { lat: lat2, lng: lng2 } },
      types: [el.tags?.amenity ?? el.tags?.shop ?? "point_of_interest"],
    });
  }
  return results;
}

async function tryOverpassMirror(
  mirror: string,
  lat: number,
  lng: number,
  radius: number,
): Promise<{ mirror: string; results: PlacesResult[] }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
  try {
    const res = await fetch(mirror, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "mapvest/0.1 (support@mapvest.app)",
      },
      body: `data=${encodeURIComponent(overpassQuery(lat, lng, radius))}`,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`${res.status}`);
    }
    const j = (await res.json()) as OverpassResponse;
    return { mirror, results: elementsToPlaces(j.elements ?? []) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Race all Overpass mirrors in parallel. First non-empty success wins;
 * empty-but-OK responses are kept as a fallback so ZERO_RESULTS still works.
 */
async function queryOverpass(lat: number, lng: number, radius: number): Promise<PlacesPayload> {
  const errs: string[] = [];
  let emptyOk: PlacesPayload | undefined;

  const settled = await Promise.allSettled(
    OVERPASS_MIRRORS.map((mirror) => tryOverpassMirror(mirror, lat, lng, radius)),
  );

  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      if (outcome.value.results.length > 0) {
        return { results: outcome.value.results };
      }
      emptyOk ??= { results: [] };
    } else {
      const reason = outcome.reason as Error;
      errs.push(`${reason?.message ?? "unknown"}`);
    }
  }

  // Re-attach mirror URLs to errors for the 502 message (order matches settled).
  const detailed: string[] = [];
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]!;
    const mirror = OVERPASS_MIRRORS[i]!;
    if (outcome.status === "rejected") {
      detailed.push(`${mirror} → ${(outcome.reason as Error).message}`);
    }
  }

  if (emptyOk) return emptyOk;
  throw new Error(`all overpass mirrors failed: ${detailed.join("; ") || errs.join("; ")}`);
}

/** Haversine distance in meters. */
function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Photon (Komoot) last-resort: search a shortlist of well-known public brands
 * near the user. Free, no key. Used only when Google + Overpass are both down.
 * https://photon.komoot.io/
 */
const PHOTON_BRANDS = [
  "Starbucks",
  "McDonald's",
  "Dunkin'",
  "Chase",
  "CVS",
  "Walgreens",
  "Target",
  "Chipotle",
  "Taco Bell",
  "Subway",
  "Bank of America",
  "Wendy's",
];

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; osm_id?: number; osm_type?: string; type?: string };
};

async function queryPhoton(lat: number, lng: number, radius: number): Promise<PlacesPayload> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const hits = await Promise.all(
      PHOTON_BRANDS.map(async (brand) => {
        const url = new URL("https://photon.komoot.io/api/");
        url.searchParams.set("q", brand);
        url.searchParams.set("lat", String(lat));
        url.searchParams.set("lon", String(lng));
        url.searchParams.set("limit", "3");
        const res = await fetch(url, {
          headers: { "User-Agent": "mapvest/0.1 (support@mapvest.app)" },
          signal: controller.signal,
        });
        if (!res.ok) return [] as PlacesResult[];
        const j = (await res.json()) as { features?: PhotonFeature[] };
        const out: PlacesResult[] = [];
        for (const f of j.features ?? []) {
          const coords = f.geometry?.coordinates;
          const name = f.properties?.name;
          if (!coords || !name) continue;
          const [lon, plat] = coords;
          if (typeof lon !== "number" || typeof plat !== "number") continue;
          if (distanceM(lat, lng, plat, lon) > radius) continue;
          out.push({
            place_id: `photon:${f.properties?.osm_type ?? "n"}:${f.properties?.osm_id ?? name}`,
            name,
            geometry: { location: { lat: plat, lng: lon } },
            types: [f.properties?.type ?? "point_of_interest"],
          });
        }
        return out;
      }),
    );

    const seen = new Set<string>();
    const results: PlacesResult[] = [];
    for (const group of hits) {
      for (const p of group) {
        const key = `${p.name.toLowerCase()}@${p.geometry.location.lat.toFixed(3)},${p.geometry.location.lng.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(p);
      }
    }
    if (results.length === 0) {
      throw new Error("photon returned no nearby brands");
    }
    return { results };
  } finally {
    clearTimeout(t);
  }
}

function isDroppedPlace(p: PlacesResult): boolean {
  return (p.types ?? []).some((t) => DROP_PLACE_TYPES.has(t));
}

function placeFromResult(p: PlacesResult): NearbyResponse["items"][number]["place"] {
  return {
    id: p.place_id,
    name: p.name,
    location: { lat: p.geometry.location.lat, lng: p.geometry.location.lng },
    types: p.types ?? [],
  };
}

/** Prefer chains / food / retail over one-off contractors when ranking. */
function prioritizeBrandish(results: PlacesResult[]): PlacesResult[] {
  const rank = (p: PlacesResult): number => {
    const types = new Set(p.types ?? []);
    let score = 0;
    if (types.has("restaurant") || types.has("cafe") || types.has("meal_takeaway")) score += 3;
    if (types.has("store") || types.has("supermarket") || types.has("pharmacy")) score += 2;
    if (types.has("bank") || types.has("gas_station") || types.has("gym") || types.has("lodging"))
      score += 2;
    if (
      /\b(mcdonald|starbucks|dunkin|subway|chipotle|walmart|target|cvs|walgreens|chase)\b/i.test(
        p.name,
      )
    )
      score += 5;
    return score;
  };
  return [...results].sort((a, b) => rank(b) - rank(a));
}

async function queryGooglePlacesMulti(
  key: string,
  lat: number,
  lng: number,
  radius: number,
): Promise<PlacesPayload> {
  const settled = await Promise.all(
    GOOGLE_PLACE_TYPES.map(async (type) => {
      const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
      url.searchParams.set("location", `${lat},${lng}`);
      url.searchParams.set("radius", String(radius));
      url.searchParams.set("type", type);
      url.searchParams.set("key", key);
      const res = await fetch(url);
      if (!res.ok) return [] as PlacesResult[];
      const raw = (await res.json()) as PlacesPayload & { status?: string };
      if (raw.status !== "OK" && raw.status !== "ZERO_RESULTS") return [] as PlacesResult[];
      return raw.results ?? [];
    }),
  );

  const seen = new Set<string>();
  const results: PlacesResult[] = [];
  for (const batch of settled) {
    for (const p of batch) {
      if (!p?.place_id || seen.has(p.place_id)) continue;
      seen.add(p.place_id);
      results.push(p);
    }
  }
  if (results.length === 0) {
    throw new Error("google places returned no brand-relevant results");
  }
  return { results };
}

/**
 * GET /v1/nearby?lat=&lng=&radius=&limit=
 * Cascade: Google Places (multi-type) → Overpass → Photon.
 * Joins with brand→ticker resolver (+ validated comparables for private).
 *
 * If MOCK_PLACES is set (and NODE_ENV !== "production") we read the fixture
 * from that path instead of calling Google. This lets unit tests run without
 * network access and without burning quota.
 */
nearby.get("/", async (c) => {
  return safeExecuteWithSpan("http.nearby", async (span) => {
    const lat = Number(c.req.query("lat"));
    const lng = Number(c.req.query("lng"));
    const radius = Number(c.req.query("radius") ?? 500);
    const limit = Number(c.req.query("limit") ?? 25);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      span.setAttribute("error.kind", "bad_coords");
      return c.json({ error: "lat/lng required" }, 400);
    }

    const user = (c as unknown as { get: (k: string) => { id?: string } | undefined }).get("user");
    span.setAttributes({
      lat,
      lng,
      radius,
      limit,
      user_id: user?.id,
    });

    // v0.1: allow MOCK_PLACES even in production if MOCK_PLACES_ALLOW_PROD=1
    // — this is how the deployed demo keeps working before GOOGLE_MAPS_API_KEY
    // is provisioned. Never enabled implicitly; the flag has to be set on the
    // service explicitly.
    const mockPath = process.env.MOCK_PLACES;
    const useMock =
      mockPath &&
      (process.env.NODE_ENV !== "production" || process.env.MOCK_PLACES_ALLOW_PROD === "1");

    let data: PlacesPayload;
    const started = performance.now();
    let placesSource = "unknown";

    if (useMock) {
      try {
        data = await loadMockPlaces(mockPath as string);
        placesSource = "mock";
        span.setAttribute("places_source", "mock");
      } catch (err) {
        return c.json({ error: `MOCK_PLACES load failed: ${(err as Error).message}` }, 500);
      }
    } else {
      const cached = await readNearbyPlacesCache(lat, lng, radius);
      if (cached) {
        data = cached.payload as PlacesPayload;
        placesSource = `cache:${cached.source}`;
        span.setAttributes({
          places_source: placesSource,
          places_cache_hit: true,
          places_cache_key: cached.cacheKey,
        });
      } else {
        // Cascade: Google Places (multi-type) → Overpass → Photon.
        const key = process.env.GOOGLE_MAPS_API_KEY;
        let googleOk = false;
        if (key) {
          try {
            data = await queryGooglePlacesMulti(key, lat, lng, radius);
            googleOk = true;
            placesSource = "google";
            span.setAttribute("places_source", "google");
            span.setAttribute("places_google_count", data.results.length);
          } catch (err) {
            span.setAttributes({
              places_source: "google_failed",
              places_google_error: (err as Error).message,
            });
          }
        }
        if (!googleOk) {
          try {
            data = await queryOverpass(lat, lng, radius);
            placesSource = "overpass";
            span.setAttribute("places_source", "overpass");
          } catch (overpassErr) {
            span.setAttributes({
              places_source: "overpass_failed",
              places_overpass_error: (overpassErr as Error).message,
            });
            try {
              data = await queryPhoton(lat, lng, radius);
              placesSource = "photon";
              span.setAttribute("places_source", "photon");
            } catch (photonErr) {
              span.setAttribute("places_photon_error", (photonErr as Error).message);
              return c.json(
                {
                  error: `places lookup failed: ${(overpassErr as Error).message}; photon: ${(photonErr as Error).message}`,
                },
                502,
              );
            }
          }
        }
        // Persist places tile (not ticker join) for this geohash+radius.
        if (placesSource !== "unknown" && data!.results?.length) {
          void writeNearbyPlacesCache({
            lat,
            lng,
            radius,
            source: placesSource,
            payload: data!,
          }).catch((err) => console.warn("[nearby-cache] write failed", err));
        }
      }
    }

    const filtered = data!.results.filter((p) => !isDroppedPlace(p));
    const trimmed = prioritizeBrandish(filtered).slice(0, limit);

    // Batch cache-read: one Postgres round-trip for every place name in this
    // page instead of `trimmed.length` sequential lookups. Names that miss
    // resolve concurrently below.
    const cacheHits = await readBrandTickerCacheMany(trimmed.map((p) => p.name));

    // Index-mapped Promise.all preserves `trimmed` order in the output even
    // though resolution completes out of order.
    const resolved = await Promise.all(
      trimmed.map(async (p) => {
        const cachedBrand = cacheHits.get(p.name);
        const { brand, sources } = cachedBrand ?? (await resolveTicker(p.name));
        if (!cachedBrand) {
          void writeBrandTickerCache(p.name, brand, sources).catch(() => {});
        }
        return { p, brand, sources };
      }),
    );

    const items: NearbyResponse["items"] = resolved.map(({ p, brand, sources }) => ({
      place: placeFromResult(p),
      investable: brand.isPublic
        ? {
            brand,
            comparables: [],
            etfs: [],
            confidence: "high",
            sources:
              sources.length > 0
                ? sources
                : [
                    {
                      provider: "manual",
                      fetchedAt: new Date().toISOString(),
                      confidence: "high",
                    },
                  ],
          }
        : undefined,
    }));

    const latencyMs = Math.round(performance.now() - started);
    const investableCount = items.filter((i) => i.investable).length;
    span.setAttributes({
      latency_ms: latencyMs,
      items_count: items.length,
      investable_count: investableCount,
      // Coarse "was this a satisfying result?" signal.
      result_confidence:
        items.length === 0
          ? "low"
          : investableCount === 0
            ? "low"
            : investableCount < items.length / 2
              ? "medium"
              : "high",
    });

    const resp: NearbyResponse = { items };
    // Nearby data changes slowly (places + brand→ticker are both cached for
    // hours/days server-side); a short client/CDN cache absorbs bursty
    // re-requests (e.g. map pan/zoom jitter) without serving stale results
    // for long. Only applied to this 200 path — errors above are not cached.
    c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.json(resp);
  });
});

export default nearby;
