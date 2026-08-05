import { Hono } from "hono";
import { sign } from "hono/jwt";
import { mapsSigningKey } from "../lib/env.js";
import { bearerAuth, type AuthEnv } from "../middleware/bearerAuth.js";

const session = new Hono<AuthEnv>();

const MAPS_TOKEN_TTL_SEC = 60 * 60; // 60 min

/**
 * POST /v1/session/maps-token
 * Auth required.
 * Returns a short-lived JWT the iOS client uses against /v1/proxy/places.
 * The real Google Maps key never touches the phone.
 */
session.post("/maps-token", bearerAuth, async (c) => {
  const user = c.get("user");
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    purpose: "maps" as const,
    sub: user.id,
    iat: nowSec,
    exp: nowSec + MAPS_TOKEN_TTL_SEC,
  };
  const token = await sign(payload, mapsSigningKey());
  const expiresAt = new Date((nowSec + MAPS_TOKEN_TTL_SEC) * 1000).toISOString();
  return c.json({ token, expiresAt });
});

export default session;
