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
import { runPushOperation } from "./lifecycle";

const PUSH_TOKEN_ID_KEY = "mapvest.pushTokenId.v1";
const EXPO_PROJECT_ID = "e3902302-dff0-4dee-9974-d74166073356";
const PUSH_IO_TIMEOUT_MS = 8_000;
const SECURE_STORE_TIMEOUT_MS = 800;

export type RegisterResult = {
  tokenId: string;
  expoToken: string;
  permissionGranted: boolean;
};

export type PushIdentity = {
  expoToken: string;
  deviceId?: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

let currentIdentity: PushIdentity | null = null;

/**
 * Read the previously-stored server-issued token id, if any. Used by the
 * Settings screen to POST prefs updates against the right token.
 */
export async function getStoredTokenId(): Promise<string | null> {
  try {
    return await withTimeout(
      SecureStore.getItemAsync(PUSH_TOKEN_ID_KEY),
      SECURE_STORE_TIMEOUT_MS,
      "SecureStore read timed out",
    );
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
    return {
      tokenId: await withTimeout(
        SecureStore.getItemAsync(PUSH_TOKEN_ID_KEY),
        SECURE_STORE_TIMEOUT_MS,
        "SecureStore read timed out",
      ),
      readable: true,
    };
  } catch {
    return { tokenId: null, readable: false };
  }
}

async function persistTokenId(id: string, isCurrent: () => boolean): Promise<boolean> {
  const write = SecureStore.setItemAsync(PUSH_TOKEN_ID_KEY, id);
  // SecureStore has no cancellation primitive. If a timed-out write resolves
  // after sign-out/account-switch invalidated this operation, remove the late
  // value so it cannot resurrect the previous account's token id.
  void write.then(
    () => {
      if (!isCurrent()) void SecureStore.deleteItemAsync(PUSH_TOKEN_ID_KEY).catch(() => undefined);
    },
    () => undefined,
  );
  try {
    await withTimeout(write, SECURE_STORE_TIMEOUT_MS, "SecureStore write timed out");
    return true;
  } catch {
    return false;
  }
}

/** Clear the account-scoped server token id after a successful unlink. */
export async function clearStoredTokenId(): Promise<void> {
  currentIdentity = null;
  try {
    await withTimeout(
      SecureStore.deleteItemAsync(PUSH_TOKEN_ID_KEY),
      SECURE_STORE_TIMEOUT_MS,
      "SecureStore delete timed out",
    );
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
  const current = await withTimeout(
    Notifications.getPermissionsAsync(),
    PUSH_IO_TIMEOUT_MS,
    "Notification permission check timed out",
  );
  if (current.status === "granted") return true;
  if (current.status === "denied" && !current.canAskAgain) return false;
  const requested = await withTimeout(
    Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    }),
    PUSH_IO_TIMEOUT_MS,
    "Notification permission request timed out",
  );
  return requested.status === "granted";
}

/**
 * Recover the physical identity even when the server-issued id was lost.
 * This never prompts; it only reads already-granted OS state.
 */
export async function getCurrentPushIdentity(): Promise<PushIdentity | null> {
  if (currentIdentity) return currentIdentity;
  if (!Device.isDevice) return null;
  try {
    const permission = await withTimeout(
      Notifications.getPermissionsAsync(),
      PUSH_IO_TIMEOUT_MS,
      "Notification permission check timed out",
    );
    if (permission.status !== "granted") return null;
    const result = await withTimeout(
      Notifications.getExpoPushTokenAsync({ projectId: EXPO_PROJECT_ID }),
      PUSH_IO_TIMEOUT_MS,
      "Expo token lookup timed out",
    );
    if (!result.data) return null;
    const identity: PushIdentity = { expoToken: result.data };
    try {
      identity.deviceId = await withTimeout(
        getDeviceId(),
        PUSH_IO_TIMEOUT_MS,
        "Device id timed out",
      );
    } catch {
      // Expo token remains a sufficient revocation identity.
    }
    currentIdentity = identity;
    return identity;
  } catch {
    return null;
  }
}

/**
 * Full registration flow. Returns null on simulator or when the platform has
 * no push support (e.g. unsupported Android device without Google Play services).
 */
export async function registerForPush(
  session: { token: string } | null,
  options: { requestPermission?: boolean } = {},
): Promise<RegisterResult | null> {
  return runPushOperation(async ({ signal, isCurrent }) => {
    if (!session?.token || !Device.isDevice) return null;

    let permissionGranted = false;
    try {
      const current = await withTimeout(
        Notifications.getPermissionsAsync(),
        PUSH_IO_TIMEOUT_MS,
        "Notification permission check timed out",
      );
      permissionGranted = current.status === "granted";
      if (!permissionGranted && options.requestPermission) {
        permissionGranted = await ensurePermissions();
      }
    } catch {
      return null;
    }
    if (!permissionGranted || !isCurrent()) return null;

    let expoToken: string;
    try {
      const res = await withTimeout(
        Notifications.getExpoPushTokenAsync({ projectId: EXPO_PROJECT_ID }),
        PUSH_IO_TIMEOUT_MS,
        "Expo token lookup timed out",
      );
      expoToken = res.data;
    } catch {
      return null;
    }
    if (!expoToken || !isCurrent()) return null;

    let deviceId: string | undefined;
    try {
      deviceId = await withTimeout(getDeviceId(), PUSH_IO_TIMEOUT_MS, "Device id timed out");
    } catch {
      // Server registration remains valid without this advisory identifier.
    }
    currentIdentity = { expoToken, ...(deviceId ? { deviceId } : {}) };
    try {
      const body = {
        token: expoToken,
        platform: Platform.OS === "android" ? "android" : "ios",
        deviceId,
      };
      const res = await withTimeout(
        fetch(`${API_URL}/v1/push/register`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify(body),
          signal,
        }),
        PUSH_IO_TIMEOUT_MS,
        "Push registration timed out",
      );
      if (!res.ok || !isCurrent()) return null;
      const j = (await res.json()) as { id?: string };
      if (!j.id || !isCurrent()) return null;
      await persistTokenId(j.id, isCurrent);
      if (!isCurrent()) return null;
      return { tokenId: j.id, expoToken, permissionGranted };
    } catch {
      return null;
    }
  });
}
