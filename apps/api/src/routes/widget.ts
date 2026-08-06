import type { WidgetNearbyResponse } from "@mapvest/core";
import { getQuote } from "@mapvest/finance";
import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { distanceM, resolveNearbyItems } from "../lib/nearby-resolve.js";

const widget = new Hono();

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 12;
const DEFAULT_RADIUS = 1500;
const MAX_QUOTE_LOOKUPS = 6;
const MAX_SNAPSHOT_PX = 640;

function parseGeo(c: {
  req: { query: (k: string) => string | undefined };
}): { lat: number; lng: number; radius: number; limit: number } | { error: string } {
  const lat = Number(c.req.query("lat"));
  const lng = Number(c.req.query("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: "lat/lng required" };
  const radius = Number(c.req.query("radius") ?? DEFAULT_RADIUS);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  return { lat, lng, radius, limit };
}

/**
 * GET /v1/widget/nearby?lat=&lng=&radius=&limit=
 *
 * Trimmed nearby payload for the iOS WidgetKit "Nearby" widget and the
 * Android home-screen widget. Same places cascade + brand join as
 * `/v1/nearby` (see `../lib/nearby-resolve.js`) but capped small and with
 * quotes attached for the top few tickers only — widgets refresh on a
 * timeline, not on demand, so this stays cheap even at scale.
 *
 * No auth required: a home-screen widget can't reliably hold a fresh bearer
 * token, and this returns the same public brand/ticker data as `/v1/nearby`.
 */
widget.get("/nearby", async (c) => {
  return safeExecuteWithSpan("http.widget.nearby", async (span) => {
    const geo = parseGeo(c);
    if ("error" in geo) {
      span.setAttribute("error.kind", "bad_coords");
      return c.json({ error: geo.error }, 400);
    }
    const { lat, lng, radius, limit } = geo;
    span.setAttributes({ lat, lng, radius, limit });

    let items: Awaited<ReturnType<typeof resolveNearbyItems>>["items"];
    try {
      ({ items } = await resolveNearbyItems({ lat, lng, radius, limit, span }));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }

    const withDistance = items.map((item) => ({
      item,
      distanceM: distanceM(lat, lng, item.place.location.lat, item.place.location.lng),
    }));
    withDistance.sort((a, b) => a.distanceM - b.distanceM);

    const tickers = [
      ...new Set(
        withDistance
          .map(({ item }) => item.investable?.brand.ticker?.symbol?.toUpperCase())
          .filter((t): t is string => !!t),
      ),
    ].slice(0, MAX_QUOTE_LOOKUPS);

    const quoteEntries = await Promise.all(
      tickers.map(async (t) => {
        try {
          const q = await getQuote(t);
          return q ? ([t, q] as const) : null;
        } catch {
          return null;
        }
      }),
    );
    const quotes = new Map(
      quoteEntries.filter((e): e is readonly [string, NonNullable<typeof e>[1]] => !!e),
    );

    const resp: WidgetNearbyResponse = {
      origin: { lat, lng },
      items: withDistance.map(({ item, distanceM: d }) => {
        const symbol = item.investable?.brand.ticker?.symbol?.toUpperCase();
        const quote = symbol ? quotes.get(symbol) : undefined;
        return {
          name: item.investable?.brand.name ?? item.place.name,
          ticker: symbol,
          isPublic: item.investable?.brand.isPublic,
          sector: item.investable?.brand.sector,
          distanceM: Math.round(d),
          price: quote?.price,
          changePct: quote?.changePct,
          location: item.place.location,
        };
      }),
      mapSnapshotUrl: buildSnapshotUrl(c, lat, lng, radius, limit),
      generatedAt: new Date().toISOString(),
    };

    span.setAttributes({ items_count: resp.items.length, quotes_count: quotes.size });
    // Widgets refresh on their own timeline (minutes, not seconds) — a
    // slightly longer cache than /v1/nearby is safe and saves upstream calls.
    c.header("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    return c.json(resp);
  });
});

function buildSnapshotUrl(
  c: { req: { url: string } },
  lat: number,
  lng: number,
  radius: number,
  limit: number,
): string | undefined {
  try {
    const base = new URL(c.req.url);
    const url = new URL("/v1/widget/map-snapshot", base.origin);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lng", String(lng));
    url.searchParams.set("radius", String(radius));
    url.searchParams.set("limit", String(limit));
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * GET /v1/widget/map-snapshot?lat=&lng=&radius=&limit=&width=&height=
 *
 * Server-rendered static map PNG with a pin for the user's location and one
 * per nearby investable, labeled by ticker. Proxies Google's Static Maps
 * API so the client — including a widget extension, which must never carry
 * app secrets — never sees `GOOGLE_MAPS_API_KEY` (same rule as the iOS maps
 * SDK token in docs/SECRETS.md).
 *
 * Returns 501 (not "unavailable" 502) when no key is configured, so widget
 * clients can distinguish "not set up" from "upstream is down" and fall
 * back to the list-only layout without retrying.
 */
widget.get("/map-snapshot", async (c) => {
  return safeExecuteWithSpan("http.widget.mapSnapshot", async (span) => {
    const geo = parseGeo(c);
    if ("error" in geo) {
      span.setAttribute("error.kind", "bad_coords");
      return c.json({ error: geo.error }, 400);
    }
    const { lat, lng, radius, limit } = geo;
    const width = Math.min(Number(c.req.query("width") ?? 480), MAX_SNAPSHOT_PX);
    const height = Math.min(Number(c.req.query("height") ?? 480), MAX_SNAPSHOT_PX);

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
      span.setAttribute("error.kind", "no_maps_key");
      return c.json({ error: "map snapshot not configured" }, 501);
    }

    let items: Awaited<ReturnType<typeof resolveNearbyItems>>["items"];
    try {
      ({ items } = await resolveNearbyItems({ lat, lng, radius, limit, span }));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }

    const mapUrl = new URL("https://maps.googleapis.com/maps/api/staticmap");
    mapUrl.searchParams.set("center", `${lat},${lng}`);
    mapUrl.searchParams.set("size", `${width}x${height}`);
    mapUrl.searchParams.set("scale", "2");
    mapUrl.searchParams.set("maptype", "roadmap");
    mapUrl.searchParams.append("markers", `color:0x1AE39A|label:•|${lat},${lng}`);
    for (const item of items.slice(0, limit)) {
      const sym = item.investable?.brand.ticker?.symbol;
      const label = (sym?.[0] ?? item.place.name[0] ?? "•").toUpperCase();
      mapUrl.searchParams.append(
        "markers",
        `color:${item.investable ? "0xF0A36B" : "0x6B7280"}|label:${label}|${item.place.location.lat},${item.place.location.lng}`,
      );
    }
    mapUrl.searchParams.set("key", key);

    const res = await fetch(mapUrl);
    if (!res.ok) {
      span.setAttributes({ error_kind: "static_map_failed", status: res.status });
      return c.json({ error: `static map failed: ${res.status}` }, 502);
    }
    const buf = await res.arrayBuffer();
    span.setAttributes({ items_count: items.length, bytes: buf.byteLength });
    c.header("Content-Type", "image/png");
    c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=900");
    return c.body(buf);
  });
});

export default widget;
