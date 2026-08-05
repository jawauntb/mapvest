import { Hono } from "hono";
import { verify } from "hono/jwt";
import { googleMapsKey, mapsSigningKey } from "../lib/env.js";

const proxy = new Hono();

/**
 * GET /v1/proxy/places?location=lat,lng&radius=...
 * Auth: Bearer <maps-jwt> (issued by /v1/session/maps-token).
 *
 * Forwards to Google Places Nearby Search using the server-side
 * GOOGLE_MAPS_API_KEY. The client never sees Google's key.
 */
proxy.get("/places", async (c) => {
  const header = c.req.header("Authorization") ?? c.req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return c.json({ error: "missing maps token" }, 401);
  }
  const token = header.slice(7).trim();
  let payload: Record<string, unknown>;
  try {
    payload = (await verify(token, mapsSigningKey(), "HS256")) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid maps token" }, 401);
  }
  if (payload.purpose !== "maps") {
    return c.json({ error: "wrong token purpose" }, 401);
  }

  const location = c.req.query("location");
  const radius = c.req.query("radius") ?? "500";
  if (!location || !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(location)) {
    return c.json({ error: "location=lat,lng required" }, 400);
  }
  const radiusNum = Number(radius);
  if (!Number.isFinite(radiusNum) || radiusNum <= 0 || radiusNum > 50_000) {
    return c.json({ error: "radius must be a positive number <= 50000" }, 400);
  }

  const key = googleMapsKey();
  if (!key) return c.json({ error: "server: GOOGLE_MAPS_API_KEY missing" }, 500);

  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("location", location);
  url.searchParams.set("radius", String(radiusNum));
  const optionalKeyword = c.req.query("keyword");
  if (optionalKeyword) url.searchParams.set("keyword", optionalKeyword);
  const optionalType = c.req.query("type");
  if (optionalType) url.searchParams.set("type", optionalType);
  url.searchParams.set("key", key);

  const res = await fetch(url);
  if (!res.ok) return c.json({ error: `places ${res.status}` }, 502);
  const data = await res.json();
  return c.json(data);
});

export default proxy;
