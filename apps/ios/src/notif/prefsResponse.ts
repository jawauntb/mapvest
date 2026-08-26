import type { PushEventKey, PushPrefs } from "./prefs";

const PUSH_EVENT_KEYS: readonly PushEventKey[] = [
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Reject malformed push responses rather than silently treating them as false-off. */
export function parsePushPrefs(value: unknown): PushPrefs {
  if (!isRecord(value)) throw new Error("Malformed notification preferences response");
  const prefs: PushPrefs = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "notifications_enabled" || (PUSH_EVENT_KEYS as readonly string[]).includes(key)) {
      if (typeof entry !== "boolean") {
        throw new Error("Malformed notification preferences response");
      }
      if (key === "notifications_enabled") prefs.notifications_enabled = entry;
      else prefs[key as PushEventKey] = entry;
      continue;
    }
    if (key === "last_lat" || key === "last_lng") {
      if (typeof entry !== "number" || !Number.isFinite(entry)) {
        throw new Error("Malformed notification preferences response");
      }
      prefs[key] = entry;
      continue;
    }
    if (key === "last_location_at") {
      if (typeof entry !== "string") throw new Error("Malformed notification preferences response");
      prefs.last_location_at = entry;
      continue;
    }
    throw new Error("Malformed notification preferences response");
  }
  return prefs;
}

export function parsePushPrefsRead(value: unknown): { prefs: PushPrefs; tokenId: string | null } {
  if (!isRecord(value) || !("prefs" in value) || !("tokenId" in value)) {
    throw new Error("Malformed notification preferences response");
  }
  if (value.tokenId !== null && (typeof value.tokenId !== "string" || !value.tokenId)) {
    throw new Error("Malformed notification preferences response");
  }
  return { prefs: parsePushPrefs(value.prefs), tokenId: value.tokenId };
}
