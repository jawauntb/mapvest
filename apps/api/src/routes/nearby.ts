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
 * GET /v1/nearby?lat=&lng=&radius=&limit=
 * Calls Google Places, joins with brand→ticker resolver.
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
      const key = process.env.GOOGLE_MAPS_API_KEY;
      if (!key) return c.json({ error: "server: GOOGLE_MAPS_API_KEY missing" }, 500);

      const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
      url.searchParams.set("location", `${lat},${lng}`);
      url.searchParams.set("radius", String(radius));
      url.searchParams.set("key", key);
      const res = await fetch(url);
      span.setAttributes({
        places_source: "google",
        places_status: res.status,
        places_latency_ms: Math.round(performance.now() - started),
      });
      if (!res.ok) return c.json({ error: `places ${res.status}` }, 502);
      data = (await res.json()) as PlacesPayload;
      // Places returns 200 even when the request was rejected (billing off,
      // key restrictions mismatched, quota, etc). Surface those instead of
      // silently returning empty items.
      const status = (data as unknown as { status?: string }).status;
      const errMsg = (data as unknown as { error_message?: string }).error_message;
      if (status && status !== "OK" && status !== "ZERO_RESULTS") {
        span.setAttributes({ places_google_status: status });
        return c.json({ error: `places ${status}: ${errMsg ?? ""}` }, 502);
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
