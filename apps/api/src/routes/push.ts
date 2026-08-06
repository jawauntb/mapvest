/**
 * /v1/push — token registration + per-event preferences for opt-in push
 * notifications. All routes require a bearer session.
 *
 * Contract:
 *   POST   /v1/push/register  { token, platform?, deviceId? }  → { id }
 *   POST   /v1/push/prefs     { tokenId, prefs }               → { prefs }
 *   GET    /v1/push/prefs                                       → { prefs, tokenId }
 *   DELETE /v1/push/token/:id                                   → 204
 *
 * The client stores the returned `id` in expo-secure-store on first
 * registration; every prefs write includes it explicitly so multi-device
 * users can toggle notifications independently per phone/tablet.
 */
import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import {
  listTokensForUser,
  PUSH_EVENT_KEYS,
  type PushEventKey,
  type PushPrefs,
  registerPushToken,
  unregisterPushToken,
  updatePrefs,
} from "../lib/push-tokens-store.js";
import { bearerAuth, type AuthEnv } from "../middleware/bearerAuth.js";

const push = new Hono<AuthEnv>();
push.use("*", bearerAuth);

// ExponentPushToken[…] or ExpoPushToken[…]. We're permissive on the exact
// prefix but reject empty/short strings so a fat-finger PUT never lands.
const EXPO_TOKEN_RE = /^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$/;

function isValidPref(k: string): k is PushEventKey {
  return (PUSH_EVENT_KEYS as readonly string[]).includes(k);
}

/** POST /v1/push/register  { token, platform?, deviceId? } → { id } */
push.post("/register", async (c) => {
  return safeExecuteWithSpan("http.push.register", async (span) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      token?: unknown;
      platform?: unknown;
      deviceId?: unknown;
    };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token || !EXPO_TOKEN_RE.test(token)) {
      return c.json({ error: "valid ExponentPushToken required" }, 400);
    }
    const platform =
      body.platform === "android" ? "android" : ("ios" as "ios" | "android");
    const deviceId =
      typeof body.deviceId === "string" && body.deviceId.trim().length > 0
        ? body.deviceId.trim().slice(0, 128)
        : undefined;

    const user = c.get("user");
    const tok = await registerPushToken(user.id, token, platform, deviceId);
    span.setAttributes({
      user_id: user.id,
      platform,
      has_device_id: Boolean(deviceId),
      token_id: tok.id,
    });
    return c.json({ id: tok.id, prefs: tok.prefs });
  });
});

/**
 * POST /v1/push/prefs  { tokenId, prefs } → { prefs }
 *
 * Merges provided prefs into the stored blob. Unknown keys are ignored so a
 * newer client sending future opt-ins is forward-compatible. Non-boolean
 * values are dropped for the event keys — client bugs must not enable pushes.
 */
push.post("/prefs", async (c) => {
  return safeExecuteWithSpan("http.push.prefs.write", async (span) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      tokenId?: unknown;
      prefs?: unknown;
    };
    const tokenId = typeof body.tokenId === "string" ? body.tokenId : "";
    if (!tokenId) return c.json({ error: "tokenId required" }, 400);
    const raw = body.prefs;
    if (!raw || typeof raw !== "object") {
      return c.json({ error: "prefs object required" }, 400);
    }
    const patch: PushPrefs = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isValidPref(k) && typeof v === "boolean") patch[k] = v;
      // Allow scheduler heartbeats (client can post current lat/lng too).
      if (k === "last_lat" && typeof v === "number") patch.last_lat = v;
      if (k === "last_lng" && typeof v === "number") patch.last_lng = v;
      if (k === "last_location_at" && typeof v === "string") {
        patch.last_location_at = v;
      }
    }

    const user = c.get("user");
    const updated = await updatePrefs(user.id, tokenId, patch);
    if (!updated) return c.json({ error: "token not found" }, 404);
    span.setAttributes({
      user_id: user.id,
      token_id: tokenId,
      keys_written: Object.keys(patch).join(","),
    });
    return c.json({ prefs: updated.prefs });
  });
});

/** GET /v1/push/prefs → { prefs, tokenId } (most recently seen token) */
push.get("/prefs", async (c) => {
  return safeExecuteWithSpan("http.push.prefs.read", async (span) => {
    const user = c.get("user");
    const tokens = await listTokensForUser(user.id);
    span.setAttributes({ user_id: user.id, token_count: tokens.length });
    if (tokens.length === 0) {
      return c.json({ prefs: {}, tokenId: null });
    }
    const most = tokens[0]!;
    return c.json({ prefs: most.prefs, tokenId: most.id });
  });
});

/** DELETE /v1/push/token/:id */
push.delete("/token/:id", async (c) => {
  return safeExecuteWithSpan("http.push.unregister", async (span) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const removed = await unregisterPushToken(user.id, id);
    span.setAttributes({ user_id: user.id, token_id: id, removed });
    if (!removed) return c.json({ error: "token not found" }, 404);
    return c.body(null, 204);
  });
});

export default push;
