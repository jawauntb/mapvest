/**
 * One-time Expo push token registration.
 *
 * Called from _layout.tsx after a session is ready. Flow:
 *   1. Read permission without prompting on launch.
 *   2. Fetch the device's Expo push token via projectId 'e3902302-…'.
 *   3. POST it to /v1/push/register with the current bearer.
 *   4. Store the returned server-issued id in expo-secure-store.
 *
 * Tokens are re-registered every launch (server-side is idempotent on
 * (userId, expoToken) unique) so a user who signs out of one account and back
 * into another lands their token under the new user.
 *
 * A launch registration never asks iOS for permission. Settings passes
 * `requestPermission: true` only after the user explicitly flips the master
 * switch. If permission is denied there is no token to register until the
 * user grants it in iOS Settings.
 *
 * On simulator: `Device.isDevice` is false, so we skip the whole thing —
 * simulator Expo tokens don't work anyway.
 */
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { getDeviceId } from "@/util/deviceId";
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

/**
 * Sign-out needs to distinguish "there is no server token" from "secure
 * storage could not be read." In the latter case a token may still exist, so
 * the caller must not clear the account until a revocation path succeeds.
 */
export async function readStoredTokenIdForSignOut(): Promise<{
  tokenId: string | null;
  readable: boolean;
}> {
  try {
    return { tokenId: await SecureStore.getItemAsync(PUSH_TOKEN_ID_KEY), readable: true };
  } catch {
    return { tokenId: null, readable: false };
  }
}

async function persistTokenId(id: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(PUSH_TOKEN_ID_KEY, id);
  } catch {
    /* SecureStore unavailable — client falls back to fetching prefs each time */
  }
}

/** Clear the account-scoped server token id after a successful unlink. */
export async function clearStoredTokenId(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PUSH_TOKEN_ID_KEY);
  } catch {
    // Revocation is already complete; a stale local id cannot re-enable a
    // token, and the next registration replaces it.
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
  options: { requestPermission?: boolean } = {},
): Promise<RegisterResult | null> {
  if (!session?.token) return null;
  if (!Device.isDevice) return null;

  let permissionGranted = false;
  try {
    const current = await Notifications.getPermissionsAsync();
    permissionGranted = current.status === "granted";
    if (!permissionGranted && options.requestPermission) {
      permissionGranted = await ensurePermissions();
    }
  } catch {
    return null;
  }
  if (!permissionGranted) return null;

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
    let deviceId: string | undefined;
    try {
      deviceId = await getDeviceId();
    } catch {
      // Server registration remains valid without this advisory identifier.
    }
    const body = {
      token: expoToken,
      platform: Platform.OS === "android" ? "android" : "ios",
      deviceId,
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
