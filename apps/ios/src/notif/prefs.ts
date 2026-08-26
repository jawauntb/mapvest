/**
 * Client wrappers around /v1/push/prefs.
 *
 * The Settings screen calls these on every toggle change and awaits the
 * server response. Return
 * types mirror the server contract in apps/api/src/routes/push.ts.
 */
import { API_URL } from "@/util/env";
import { parsePushPrefs, parsePushPrefsRead } from "./prefsResponse";
import { getStoredTokenId, registerForPush } from "./registerForPush";
import {
  buildExpiredSessionRevokeRequest,
  buildPushRevokeRequest,
  isSuccessfulPushRevocation,
} from "./revokeOutcome";

const PUSH_NETWORK_TIMEOUT_MS = 8_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_NETWORK_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export type PushEventKey =
  | "daily_brief"
  | "local_brief"
  | "price_alerts"
  | "memo_finished"
  | "agent_response"
  | "identify_done"
  | "watchlist_mover"
  | "find_evolution"
  | "uncaught_nearby";

export type PushPrefs = Partial<Record<PushEventKey, boolean>> & {
  /** Persisted product-level switch, separate from iOS authorization. */
  notifications_enabled?: boolean;
  last_lat?: number;
  last_lng?: number;
  last_location_at?: string;
};

/** The authenticated identity needed for non-prompting registration recovery. */
export type PushSession = { token: string; userId: string };

export const PUSH_EVENT_LABELS: Record<PushEventKey, string> = {
  daily_brief: "Daily brief",
  local_brief: "Local economy brief (when you move to a new area)",
  price_alerts: "Price alerts",
  memo_finished: "Memo finished writing",
  agent_response: "Agent response ready",
  identify_done: "Image processing done",
  watchlist_mover: "Watchlist movers (over 5% intraday)",
  find_evolution: "Find evolutions (something you found is up since you found it)",
  uncaught_nearby: "Uncaught nearby (a brand you haven't caught is close by)",
};

export const PUSH_EVENT_ORDER: PushEventKey[] = [
  "daily_brief",
  "local_brief",
  "price_alerts",
  "memo_finished",
  "agent_response",
  "identify_done",
  "watchlist_mover",
  "find_evolution",
  "uncaught_nearby",
];

/** GET /v1/push/prefs?tokenId=… → { prefs, tokenId } */
export async function getPushPrefs(
  session: { token: string },
  tokenId?: string | null,
): Promise<{
  prefs: PushPrefs;
  tokenId: string | null;
}> {
  const query = tokenId ? `?tokenId=${encodeURIComponent(tokenId)}` : "";
  const res = await fetchWithTimeout(`${API_URL}/v1/push/prefs${query}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.token}`,
    },
  });
  if (!res.ok) {
    let message = `Could not load notification settings (${res.status})`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) message = body.error;
    } catch {
      // Keep the status-based message when the API did not return JSON.
    }
    throw new Error(message);
  }
  return parsePushPrefsRead(await res.json());
}

/**
 * Read this installation's preferences only. A stale SecureStore id cannot
 * fall through to an account's other device: when the exact lookup misses, we
 * re-register the physical Expo token without asking iOS for permission, then
 * read only the returned opaque id. No token / no existing permission simply
 * yields the explicit empty-device state.
 */
export async function getCurrentDevicePushPrefs(session: PushSession): Promise<{
  prefs: PushPrefs;
  tokenId: string | null;
}> {
  const stored = await getStoredTokenId();
  if (stored) {
    const current = await getPushPrefs(session, stored);
    if (current.tokenId === stored) return current;
  }

  const registration = await registerForPush(session, { requestPermission: false });
  if (!registration) return { prefs: {}, tokenId: null };

  const recovered = await getPushPrefs(session, registration.tokenId);
  return recovered.tokenId === registration.tokenId ? recovered : { prefs: {}, tokenId: null };
}

/**
 * POST /v1/push/prefs — merge patch into the token's stored prefs.
 * Rejects on a non-2xx response so Settings can roll back an optimistic
 * switch and offer a retry instead of showing a setting that did not persist.
 */
export async function setPushPref(
  tokenId: string,
  patch: Partial<PushPrefs>,
  session: { token: string },
): Promise<PushPrefs> {
  const res = await fetchWithTimeout(`${API_URL}/v1/push/prefs`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ tokenId, prefs: patch }),
  });
  if (!res.ok) {
    let message = `Could not save notification settings (${res.status})`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) message = body.error;
    } catch {
      // Keep the status-based message when the API did not return JSON.
    }
    throw new Error(message);
  }
  const body: unknown = await res.json();
  if (!body || typeof body !== "object" || Array.isArray(body) || !("prefs" in body)) {
    throw new Error("Malformed notification preferences response");
  }
  return parsePushPrefs(body.prefs);
}

/**
 * Remove this installation's server token before clearing its bearer session.
 * A real 204 delete is authoritative. A 404 is deliberately surfaced so the
 * caller can use the claimant-identity endpoint and distinguish an
 * already-revoked row from a stale or mismatched local id.
 */
export async function unlinkPushToken(tokenId: string, session: { token: string }): Promise<void> {
  const res = await fetchWithTimeout(`${API_URL}/v1/push/token/${encodeURIComponent(tokenId)}`, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.token}`,
    },
  });
  // The current authenticated contract is 204 on a real delete. A typed
  // idempotent outcome is also accepted for mixed-version deployments; a
  // 404 deliberately falls through as an error so identity recovery can
  // distinguish an already-revoked row from a stale/corrupt local id.
  if (res.status === 204) return;
  if (res.ok) {
    const body = await res.json().catch(() => null);
    if (isSuccessfulPushRevocation(body)) return;
  }

  let message = `Could not remove this device from notifications (${res.status})`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) message = body.error;
  } catch {
    // Keep the status-based message when the API did not return JSON.
  }
  throw new Error(message);
}

/**
 * Claimant-bound fallback for expired sessions or a lost SecureStore id.
 * With an opaque id this uses the public exact-claim endpoint. Without one it
 * requires a valid bearer and uses the authenticated current-device endpoint;
 * token-only public requests are never constructed.
 */
export async function unlinkPushTokenByIdentity(
  identity: { expoToken: string; deviceId?: string },
  tokenId?: string | null,
  session?: { token: string },
): Promise<void> {
  const request = buildPushRevokeRequest(API_URL, identity, tokenId, session);
  const res = await fetchWithTimeout(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  if (res.ok) {
    const body = await res.json().catch(() => null);
    if (isSuccessfulPushRevocation(body)) return;
  }
  throw new Error(`Could not remove this device from notifications (${res.status})`);
}

/**
 * Recovery for a cryptographically valid but expired bearer. This route is
 * intentionally separate from the public exact-id route: it lets the server
 * verify the old account before matching the persisted Expo identity, without
 * allowing an incoming account to revoke another account's claim.
 */
export async function unlinkPushTokenByExpiredSession(
  identity: { expoToken: string; deviceId?: string } | null,
  session: { token: string },
  tokenId?: string | null,
): Promise<void> {
  const request = buildExpiredSessionRevokeRequest(API_URL, identity, session, tokenId);
  const res = await fetchWithTimeout(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  if (res.ok) {
    const body = await res.json().catch(() => null);
    if (isSuccessfulPushRevocation(body)) return;
  }
  throw new Error(`Could not remove this device from notifications (${res.status})`);
}

/**
 * Heartbeat the user's last known coordinates so the push scheduler can
 * decide when a "you moved to a new area" local-brief notification is due.
 * Resolves only this device's stored opaque id, or (when the caller supplies
 * its user id) recovers by re-registering the physical token without an iOS
 * permission prompt. It never uses account-level preferences as a fallback.
 */
export async function heartbeatLocation(
  lat: number,
  lng: number,
  token: string,
  userId?: string,
): Promise<boolean> {
  const session = userId ? { token, userId } : null;
  const stored = await getStoredTokenId();
  let tokenId: string | null = null;

  if (stored) {
    const current = await getPushPrefs({ token }, stored);
    if (current.tokenId === stored) tokenId = stored;
  }
  if (!tokenId && session) {
    const recovered = await getCurrentDevicePushPrefs(session);
    tokenId = recovered.tokenId;
  }
  if (!tokenId) return false;
  await setPushPref(
    tokenId,
    { last_lat: lat, last_lng: lng, last_location_at: new Date().toISOString() },
    { token },
  );
  return true;
}
