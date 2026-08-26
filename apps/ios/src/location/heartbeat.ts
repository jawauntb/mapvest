/**
 * Location heartbeat — roadmap §2 B3/B5.
 *
 * One place that answers "the app learned where the user is; tell the server."
 * The server side already exists: `push_tokens.prefs.last_lat/last_lng` via
 * `POST /v1/push/prefs` (see `heartbeatLocation` in src/notif/prefs.ts and
 * apps/api/src/routes/push.ts). This module adds the two callers the roadmap
 * needs that can't reach React context:
 *
 * - `postHeartbeat(coords)` — usable from a background TaskManager task
 *   (B5 visit monitoring), so it resolves the session token from SecureStore
 *   itself rather than taking it from a hook.
 * - `syncWidgetFixIfFresh()` — relays a fix the *widget extension* captured
 *   while the app was closed (B3). The widget has no session token and a
 *   very small execution budget, so it stashes fixes in the shared App Group
 *   and the app forwards them on foreground.
 *
 * Everything here fails soft: no session, no push token, no network, no
 * native module — every path returns false instead of throwing.
 *
 * DEFERRED ACCEPTANCE (B3): the widget half only produces fixes after the
 * user's next `expo prebuild` + device build, exactly like the Phase 9 widget
 * work. Until then `syncWidgetFixIfFresh()` is a no-op that returns false.
 */
import type { LatLng } from "@/api/types";
import { heartbeatLocation } from "@/notif/prefs";
import { readWidgetCapturedFix } from "@/widgets/widgetLocation";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

/**
 * Mirrors `KEY` / `STORE` in src/auth/session.tsx — that module keeps them
 * private and only exposes the session through React context, which a
 * background task can't touch. Keep these two in sync if the session store
 * ever changes shape.
 */
const SESSION_KEY = "mapvest.session.v1";
const SESSION_STORE: SecureStore.SecureStoreOptions = {
  keychainService: "com.mapvest.app",
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/** Record of the last heartbeat this device actually sent. */
const LAST_SENT_KEY = "mapvest.location.lastHeartbeat.v1";

/**
 * A widget fix older than this is stale enough that posting it would move the
 * server's idea of "where you are" backwards. Widgets refresh on the order of
 * every 30 minutes, so anything this old means the widget hasn't run in a
 * long while.
 */
const MAX_WIDGET_FIX_AGE_MS = 6 * 60 * 60 * 1000;

type LastSent = { lat: number; lng: number; at: number };

async function readSession(): Promise<{ token: string; userId: string } | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY, SESSION_STORE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      session?: { token?: string; userId?: string; expiresAt?: string };
    };
    const token = parsed?.session?.token;
    const userId = parsed?.session?.userId;
    if (!token || !userId) return null;
    const expiresAt = parsed.session?.expiresAt;
    // Don't spend a network round trip on a token the API will reject.
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) return null;
    return { token, userId };
  } catch {
    return null;
  }
}

async function readLastSent(): Promise<LastSent | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastSent>;
    if (typeof parsed?.at !== "number" || !Number.isFinite(parsed.at)) return null;
    if (typeof parsed.lat !== "number" || typeof parsed.lng !== "number") return null;
    return { lat: parsed.lat, lng: parsed.lng, at: parsed.at };
  } catch {
    return null;
  }
}

function isUsable(coords: LatLng): boolean {
  return (
    Number.isFinite(coords?.lat) &&
    Number.isFinite(coords?.lng) &&
    Math.abs(coords.lat) <= 90 &&
    Math.abs(coords.lng) <= 180 &&
    // (0, 0) is the classic "sensor returned nothing" value, and Null Island
    // is not a place anyone catches brands.
    !(coords.lat === 0 && coords.lng === 0)
  );
}

/**
 * POSTs a fix to the existing push-prefs heartbeat
 * (`prefs.last_lat` / `last_lng` / `last_location_at`), which is what the
 * server's >2km move trigger and the B4 arrival pipeline read.
 *
 * Safe to call from a background task: resolves the session itself, swallows
 * every error, and returns whether the heartbeat actually went out.
 */
export async function postHeartbeat(coords: LatLng): Promise<boolean> {
  if (!isUsable(coords)) return false;
  try {
    const session = await readSession();
    if (!session) return false;
    // No-op unless this device has an exact stored registration or can recover
    // its own physical Expo token without prompting for permission.
    const sent = await heartbeatLocation(coords.lat, coords.lng, session.token, session.userId);
    if (!sent) return false;
    const record: LastSent = { lat: coords.lat, lng: coords.lng, at: Date.now() };
    await AsyncStorage.setItem(LAST_SENT_KEY, JSON.stringify(record)).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Relays a fix captured by the WidgetKit extension while the app was closed
 * (roadmap §2 B3) — call it on app foreground.
 *
 * Posts only when the widget's fix is both recent and newer than the last
 * heartbeat this device sent, so a foreground fix the app just posted itself
 * is never overwritten by an older widget one. Returns true only if a
 * heartbeat actually went out.
 */
export async function syncWidgetFixIfFresh(): Promise<boolean> {
  try {
    const fix = await readWidgetCapturedFix();
    if (!fix) return false;

    const age = Date.now() - fix.capturedAt;
    // Negative age = device clock skew; treat as untrustworthy.
    if (age < 0 || age > MAX_WIDGET_FIX_AGE_MS) return false;

    const lastSent = await readLastSent();
    if (lastSent && fix.capturedAt <= lastSent.at) return false;

    return await postHeartbeat({ lat: fix.lat, lng: fix.lng });
  } catch {
    return false;
  }
}
