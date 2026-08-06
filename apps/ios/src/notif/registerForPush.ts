/**
 * One-time Expo push token registration.
 *
 * Called from _layout.tsx after a session is ready. Flow:
 *   1. Request permission (idempotent — Expo NoOps if already granted/denied).
 *   2. Fetch the device's Expo push token via projectId 'e3902302-…'.
 *   3. POST it to /v1/push/register with the current bearer.
 *   4. Store the returned server-issued id in expo-secure-store.
 *
 * Tokens are re-registered every launch (server-side is idempotent on
 * (userId, expoToken) unique) so a user who signs out of one account and back
 * into another lands their token under the new user.
 *
 * If permission is DENIED we still register the token — the spec says to
 * keep prefs disabled by default, so nothing pushes anyway, and if the user
 * later flips a toggle we already have a token to push to.
 *
 * On simulator: `Device.isDevice` is false, so we skip the whole thing —
 * simulator Expo tokens don't work anyway.
 */
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { API_URL } from "@/util/env";

const PUSH_TOKEN_ID_KEY = "mapvest.pushTokenId.v1";
const EXPO_PROJECT_ID = "e3902302-dff0-4dee-9974-d74166073356";

export type RegisterResult = {
  tokenId: string;
  expoToken: string;
  permissionGranted: boolean;
};

/**
 * Read the previously-stored server-issued token id, if any. Used by the
 * Settings screen to POST prefs updates against the right token.
 */
export async function getStoredTokenId(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(PUSH_TOKEN_ID_KEY);
  } catch {
    return null;
  }
}

async function persistTokenId(id: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(PUSH_TOKEN_ID_KEY, id);
  } catch {
    /* SecureStore unavailable — client falls back to fetching prefs each time */
  }
}

/**
 * Request notification permissions from the OS. Returns whether the current
 * status is `granted`. Safe to call multiple times.
 */
export async function ensurePermissions(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.status === "granted") return true;
  if (current.status === "denied" && !current.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
  return requested.status === "granted";
}

/**
 * Full registration flow. Returns null on simulator or when the platform has
 * no push support (e.g. unsupported Android device without Google Play services).
 */
export async function registerForPush(
  session: { token: string } | null,
): Promise<RegisterResult | null> {
  if (!session?.token) return null;
  if (!Device.isDevice) return null;

  const permissionGranted = await ensurePermissions();

  let expoToken: string;
  try {
    const res = await Notifications.getExpoPushTokenAsync({
      projectId: EXPO_PROJECT_ID,
    });
    expoToken = res.data;
  } catch {
    // Token fetch can fail on simulator, permission-denied, or transient
    // Expo push service issues. Nothing to store — bail out silently.
    return null;
  }
  if (!expoToken) return null;

  try {
    const body = {
      token: expoToken,
      platform: Platform.OS === "android" ? "android" : "ios",
    };
    const res = await fetch(`${API_URL}/v1/push/register`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { id?: string };
    if (!j.id) return null;
    await persistTokenId(j.id);
    return { tokenId: j.id, expoToken, permissionGranted };
  } catch {
    return null;
  }
}
