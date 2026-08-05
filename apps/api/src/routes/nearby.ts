import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import type { NearbyResponse } from "@mapvest/core";
import { resolveTicker } from "@mapvest/finance";
import { safeExecuteWithSpan } from "../lib/logfire.js";

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
async function queryOverpass(
  lat: number,
  lng: number,
  radius: number,
): Promise<PlacesPayload> {
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

async function queryPhoton(
  lat: number,
  lng: number,
  radius: number,
): Promise<PlacesPayload> {
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

/**
 * GET /v1/nearby?lat=&lng=&radius=&limit=
 * Cascade: Google Places (if key + billing) → Overpass (OSM mirrors, raced)
 * → Photon brand search. Joins with brand→ticker resolver.
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

    const user = (c as unknown as { get: (k: string) => { id?: string } | undefined }).get(
      "user",
    );
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
      (process.env.NODE_ENV !== "production" ||
        process.env.MOCK_PLACES_ALLOW_PROD === "1");

    let data: PlacesPayload;
    const started = performance.now();
    if (useMock) {
      try {
        data = await loadMockPlaces(mockPath as string);
        span.setAttribute("places_source", "mock");
      } catch (err) {
        return c.json({ error: `MOCK_PLACES load failed: ${(err as Error).message}` }, 500);
      }
    } else {
      // Cascade: Google Places (if key + billing) → Overpass → Photon.
      // Never fail the request until every free path is exhausted.
      const key = process.env.GOOGLE_MAPS_API_KEY;
      let googleOk = false;
      if (key) {
        try {
          const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
          url.searchParams.set("location", `${lat},${lng}`);
          url.searchParams.set("radius", String(radius));
          url.searchParams.set("key", key);
          const res = await fetch(url);
          if (res.ok) {
            const raw = (await res.json()) as PlacesPayload;
            const status = (raw as unknown as { status?: string }).status;
            if (status === "OK" || status === "ZERO_RESULTS") {
              data = raw;
              googleOk = true;
              span.setAttribute("places_source", "google");
            } else {
              span.setAttributes({
                places_source: "google_failed",
                places_google_status: status ?? "unknown",
              });
            }
          }
        } catch (err) {
          span.setAttribute("places_google_error", (err as Error).message);
        }
      }
      if (!googleOk) {
        try {
          data = await queryOverpass(lat, lng, radius);
          span.setAttribute("places_source", "overpass");
        } catch (overpassErr) {
          span.setAttributes({
            places_source: "overpass_failed",
            places_overpass_error: (overpassErr as Error).message,
          });
          try {
            data = await queryPhoton(lat, lng, radius);
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
    }

    const trimmed = data.results.slice(0, limit);
    const items: NearbyResponse["items"] = [];
    for (const p of trimmed) {
      const { brand } = await resolveTicker(p.name);
      items.push({
        place: {
          id: p.place_id,
          name: p.name,
          location: { lat: p.geometry.location.lat, lng: p.geometry.location.lng },
          types: p.types ?? [],
        },
        investable: brand.isPublic
          ? {
              brand,
              comparables: [],
              etfs: [],
              confidence: "high",
              sources: [
                { provider: "manual", fetchedAt: new Date().toISOString(), confidence: "high" },
              ],
            }
          : undefined,
      });
    }

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
    return c.json(resp);
  });
});

export default nearby;
