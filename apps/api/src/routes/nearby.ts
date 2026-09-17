import type { NearbyResponse } from "@mapvest/core";
import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { resolveNearbyItems } from "../lib/nearby-resolve.js";

const nearby = new Hono();

/**
 * GET /v1/nearby?lat=&lng=&radius=&limit=
 * Cascade: Google Places (multi-type) → Overpass → Photon.
 * Joins with brand→ticker resolver (+ validated comparables for private).
 *
 * If MOCK_PLACES is set (and NODE_ENV !== "production") we read the fixture
 * from that path instead of calling Google. This lets unit tests run without
 * network access and without burning quota.
 *
 * Shares its places-resolution + brand join with `/v1/widget/nearby` via
 * `../lib/nearby-resolve.js` — see that module for the cascade + caching.
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

    const started = performance.now();
    let items: NearbyResponse["items"];
    try {
      ({ items } = await resolveNearbyItems({ lat, lng, radius, limit, span }));
    } catch (err) {
      const message = (err as Error).message;
      // Bad MOCK_PLACES config is a deploy/dev mistake, not an upstream
      // outage — keep it a 500 like the original inline handler did.
      const status = message.startsWith("MOCK_PLACES") ? 500 : 502;
      return c.json({ error: message }, status);
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
    // Nearby data changes slowly (places + brand→ticker are both cached for
    // hours/days server-side); a short client/CDN cache absorbs bursty
    // re-requests (e.g. map pan/zoom jitter) without serving stale results
    // for long. Only applied to this 200 path — errors above are not cached.
    c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.json(resp);
  });
});

export default nearby;
