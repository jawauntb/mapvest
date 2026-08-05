import { Hono } from "hono";
import type { NearbyResponse } from "@mapvest/core";
import { resolveTicker } from "@mapvest/finance";

const nearby = new Hono();

/**
 * GET /v1/nearby?lat=&lng=&radius=&limit=
 * Calls Google Places, joins with brand→ticker resolver.
 */
nearby.get("/", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lng = Number(c.req.query("lng"));
  const radius = Number(c.req.query("radius") ?? 500);
  const limit = Number(c.req.query("limit") ?? 25);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: "lat/lng required" }, 400);
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return c.json({ error: "server: GOOGLE_MAPS_API_KEY missing" }, 500);

  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", String(radius));
  url.searchParams.set("key", key);
  const res = await fetch(url);
  if (!res.ok) return c.json({ error: `places ${res.status}` }, 502);
  const data = (await res.json()) as {
    results: Array<{
      place_id: string;
      name: string;
      geometry: { location: { lat: number; lng: number } };
      types: string[];
    }>;
  };

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

  const resp: NearbyResponse = { items };
  return c.json(resp);
});

export default nearby;
