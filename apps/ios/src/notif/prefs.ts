/**
 * Client wrappers around /v1/push/prefs.
 *
 * The Settings screen calls these on every toggle change and awaits the
 * server response. Return
 * types mirror the server contract in apps/api/src/routes/push.ts.
 */
import { API_URL } from "@/util/env";
import { getStoredTokenId } from "./registerForPush";

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

/** GET /v1/push/prefs → { prefs, tokenId } */
export async function getPushPrefs(
  session: { token: string },
  tokenId?: string | null,
): Promise<{
  prefs: PushPrefs;
  tokenId: string | null;
}> {
  const query = tokenId ? `?tokenId=${encodeURIComponent(tokenId)}` : "";
  const res = await fetch(`${API_URL}/v1/push/prefs${query}`, {
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
  const j = (await res.json()) as { prefs?: PushPrefs; tokenId?: string | null };
  return { prefs: j.prefs ?? {}, tokenId: j.tokenId ?? null };
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
  const res = await fetch(`${API_URL}/v1/push/prefs`, {
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
  const body = (await res.json()) as { prefs?: PushPrefs };
  return body.prefs ?? patch;
}

/**
 * Heartbeat the user's last known coordinates so the push scheduler can
 * decide when a "you moved to a new area" local-brief notification is due.
 * Resolves the device's push token id (stored id first, server lookup as
 * fallback) and no-ops when this device never registered for push.
 */
export async function heartbeatLocation(lat: number, lng: number, token: string): Promise<void> {
  const tokenId = (await getStoredTokenId()) ?? (await getPushPrefs({ token })).tokenId;
  if (!tokenId) return;
  await setPushPref(
    tokenId,
    { last_lat: lat, last_lng: lng, last_location_at: new Date().toISOString() },
    { token },
  );
}
