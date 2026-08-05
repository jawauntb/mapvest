import * as SecureStore from "expo-secure-store";

const KEY = "mapvest.deviceId.v1";

let cached: string | null = null;
let inflight: Promise<string> | null = null;

/**
 * RFC 4122-ish v4 UUID via Math.random(). Not cryptographically strong —
 * this id only anonymously buckets a device for the free-generation meter
 * (Phase 8 Slice C), never for security/auth decisions, so no native crypto
 * module is worth the extra pod install / rebuild.
 */
function randomUuidV4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Stable per-install device id, generated once and persisted in SecureStore.
 * Sent as `X-Device-Id` on API requests so anonymous (guest) usage can be
 * metered without requiring sign-in. Safe to call repeatedly / concurrently.
 */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const existing = await SecureStore.getItemAsync(KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
    const next = randomUuidV4();
    await SecureStore.setItemAsync(KEY, next);
    cached = next;
    return next;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
