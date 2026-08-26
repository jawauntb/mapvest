/**
 * /v1/push — token registration + per-event preferences for opt-in push
 * notifications. Registration/preferences require a bearer session; the
 * revocation-only device fallback intentionally does not.
 *
 * Contract:
 *   POST   /v1/push/register  { token, platform?, deviceId? }  → { id }
 *   POST   /v1/push/prefs     { tokenId, prefs }               → { prefs }
 *   GET    /v1/push/prefs                                       → { prefs, tokenId }
 *   DELETE /v1/push/token/:id                                   → 204
 *   POST   /v1/push/revoke-device { token, tokenId, deviceId? } → { revoked, matched, outcome }
 *   POST   /v1/push/revoke-expired-session-device { token? | tokenId?, deviceId? } → { revoked, matched, outcome }
 *   POST   /v1/push/revoke-current-device { token, deviceId? } → { revoked, matched, outcome }
 *
 * The client stores the returned `id` in expo-secure-store on first
 * registration; every prefs write includes it explicitly so multi-device
 * users can toggle notifications independently per phone/tablet.
 */
import {
  PushCurrentDeviceRevocationRequest,
  type PushDeviceRevocationOutcome,
  PushDeviceRevocationRequest,
  type PushDeviceRevocationResponse,
  PushExpiredSessionDeviceRevocationRequest,
} from "@mapvest/core";
import { Hono } from "hono";
import { verify } from "hono/jwt";
import { sessionSigningKey } from "../lib/env.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import {
  PUSH_EVENT_KEYS,
  type PushEventKey,
  type PushPrefs,
  listTokensForUser,
  registerPushToken,
  unregisterCurrentUsersPushTokenByExpo,
  unregisterCurrentUsersPushTokenByTokenId,
  unregisterPushToken,
  unregisterPushTokenByIdentity,
  updatePrefs,
} from "../lib/push-tokens-store.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

const push = new Hono<AuthEnv>();

// ExponentPushToken[…] or ExpoPushToken[…]. Registration predates the shared
// contract; revocation routes use the canonical Zod schemas above.
const EXPO_TOKEN_RE = /^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$/;
const EXPIRED_SESSION_REVOKE_WINDOW_SEC = 90 * 24 * 60 * 60;

function revocationResponse(outcome: PushDeviceRevocationOutcome): PushDeviceRevocationResponse {
  switch (outcome) {
    case "revoked":
      return { revoked: true, matched: true, outcome };
    case "already-revoked":
      return { revoked: true, matched: false, outcome };
    case "claim-mismatch":
      return { revoked: false, matched: false, outcome };
  }
}

function revocationStatus(outcome: PushDeviceRevocationOutcome): 200 | 409 {
  // Older shipped clients treated every 2xx public fallback response as a
  // successful cleanup. A stale opaque id must therefore be non-2xx until all
  // clients understand the typed ownership outcome.
  return outcome === "claim-mismatch" ? 409 : 200;
}

async function expiredSessionSubject(
  header: string | undefined,
  hasOpaqueTokenId: boolean,
): Promise<string | null> {
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  let payload: Record<string, unknown>;
  try {
    // This endpoint deliberately skips only expiry verification. Signature,
    // algorithm, iat, and nbf remain checked, and the route can only delete a
    // push claim for the signed subject below.
    payload = (await verify(token, sessionSigningKey(), {
      alg: "HS256",
      exp: false,
    })) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (payload.purpose !== "session" || typeof payload.sub !== "string" || !payload.sub) {
    return null;
  }
  const exp = typeof payload.exp === "number" ? payload.exp : Number.NaN;
  const nowSec = Math.floor(Date.now() / 1000);
  // An Expo token is a transferable physical identifier, so token-only
  // recovery is deliberately time-bounded. An opaque registration id instead
  // identifies one historical row; the store still requires that exact row
  // and signed subject to own the active claim before it can delete anything.
  if (
    !Number.isFinite(exp) ||
    exp > nowSec ||
    (!hasOpaqueTokenId && nowSec - exp > EXPIRED_SESSION_REVOKE_WINDOW_SEC)
  ) {
    return null;
  }
  return payload.sub;
}

/**
 * Revocation-only recovery path. It is intentionally mounted before the
 * bearer middleware because an expired/invalid session may still have the
 * opaque id it was issued at registration. It requires that id as well as the
 * Expo token, so a stale installation cannot revoke a later account owner.
 */
push.post("/revoke-device", async (c) => {
  return safeExecuteWithSpan("http.push.revoke_device", async (span) => {
    const parsed = PushDeviceRevocationRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success)
      return c.json({ error: "valid tokenId and ExponentPushToken required" }, 400);
    const { token, tokenId, deviceId } = parsed.data;
    const outcome = await unregisterPushTokenByIdentity(token, tokenId, deviceId);
    span.setAttributes({
      has_device_id: Boolean(deviceId),
      has_token_id: Boolean(tokenId),
      outcome,
    });
    return c.json(revocationResponse(outcome), revocationStatus(outcome));
  });
});

/**
 * Recovery for a session JWT that is cryptographically valid but has expired.
 * It cannot read user state: the signed `sub` plus a physical Expo token, or
 * its historical opaque id when iOS cannot obtain a token, may only unlink
 * that same active claim. Expo-token-only recovery expires after 90 days;
 * exact opaque token-id recovery remains available for historical cleanup.
 */
push.post("/revoke-expired-session-device", async (c) => {
  return safeExecuteWithSpan("http.push.revoke_expired_session_device", async (span) => {
    const parsed = PushExpiredSessionDeviceRevocationRequest.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return c.json({ error: "valid ExponentPushToken or opaque tokenId required" }, 400);
    }
    const { token, tokenId, deviceId } = parsed.data;
    const userId = await expiredSessionSubject(
      c.req.header("Authorization") ?? c.req.header("authorization"),
      Boolean(tokenId),
    );
    if (!userId) return c.json({ error: "expired session recovery token required" }, 401);
    const outcome = tokenId
      ? await unregisterCurrentUsersPushTokenByTokenId(userId, tokenId, token, deviceId)
      : await unregisterCurrentUsersPushTokenByExpo(userId, token!, deviceId);
    span.setAttributes({
      user_id: userId,
      has_device_id: Boolean(deviceId),
      has_token: Boolean(token),
      has_token_id: Boolean(tokenId),
      outcome,
    });
    return c.json(revocationResponse(outcome), revocationStatus(outcome));
  });
});

push.use("*", bearerAuth);

/**
 * Authenticated recovery for a valid session whose SecureStore token id was
 * lost. Account authentication plus the Expo identity is sufficient here;
 * an expired session without the opaque id must fail closed via the public
 * route rather than guessing at a later token owner.
 */
push.post("/revoke-current-device", async (c) => {
  return safeExecuteWithSpan("http.push.revoke_current_device", async (span) => {
    const parsed = PushCurrentDeviceRevocationRequest.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) return c.json({ error: "valid ExponentPushToken required" }, 400);
    const { token, deviceId } = parsed.data;
    const user = c.get("user");
    const outcome = await unregisterCurrentUsersPushTokenByExpo(user.id, token, deviceId);
    span.setAttributes({ user_id: user.id, has_device_id: Boolean(deviceId), outcome });
    return c.json(revocationResponse(outcome), revocationStatus(outcome));
  });
});

function isValidPref(k: string): k is PushEventKey {
  return (PUSH_EVENT_KEYS as readonly string[]).includes(k);
}

function isMasterPref(k: string): k is "notifications_enabled" {
  return k === "notifications_enabled";
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
    const platform = body.platform === "android" ? "android" : ("ios" as "ios" | "android");
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
      if ((isValidPref(k) || isMasterPref(k)) && typeof v === "boolean") {
        patch[k] = v;
      }
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

/** GET /v1/push/prefs[?tokenId=…] → { prefs, tokenId } */
push.get("/prefs", async (c) => {
  return safeExecuteWithSpan("http.push.prefs.read", async (span) => {
    const user = c.get("user");
    const tokens = await listTokensForUser(user.id);
    span.setAttributes({ user_id: user.id, token_count: tokens.length });
    if (tokens.length === 0) {
      return c.json({ prefs: {}, tokenId: null });
    }
    const requestedId = c.req.query("tokenId");
    const selected = requestedId ? tokens.find((token) => token.id === requestedId) : tokens[0];
    if (!selected) return c.json({ prefs: {}, tokenId: null });
    return c.json({ prefs: selected.prefs, tokenId: selected.id });
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
