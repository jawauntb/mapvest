import AsyncStorage from "@react-native-async-storage/async-storage";
/**
 * One-time Expo push token registration.
 *
 * Called from _layout.tsx after a session is ready. Flow:
 *   1. Read permission without prompting on launch.
 *   2. Fetch the device's Expo push token via projectId 'e3902302-…'.
 *   3. POST it to /v1/push/register with the current bearer.
 *   4. Store the returned server-issued id in expo-secure-store and retain a
 *      non-secret registration marker until server revocation succeeds.
 *
 * Tokens are re-registered every launch (server-side is idempotent on
 * (userId, expoToken) unique) so a user who signs out of one account and back
 * into another lands their token under the new user.
 *
 * A launch registration never asks iOS for permission. Settings and the
 * Camera's explicit post-value Find evolution CTA may ask only after a
 * direct user action. If permission is denied there is no token to register
 * until the user grants it in iOS Settings.
 *
 * On simulator: `Device.isDevice` is false, so we skip the whole thing —
 * simulator Expo tokens don't work anyway.
 */
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { CleanupPushSnapshot } from "@/auth/sessionController";
import { getDeviceId } from "@/util/deviceId";
import { API_URL } from "@/util/env";
import { runPushOperation } from "./lifecycle";
import {
  type PushTokenIdStorage,
  deletePersistedPushTokenId,
  persistPushTokenId,
  waitForPushTokenIdMutation,
} from "./pushRegistrationStore";
import { isSuccessfulPushRevocation } from "./revokeOutcome";

const PUSH_TOKEN_ID_KEY = "mapvest.pushTokenId.v1";
const PUSH_MAYBE_REGISTERED_KEY = "mapvest.pushMayBeRegistered.v1";
const PUSH_CLAIM_SNAPSHOT_KEY = "mapvest.pushRegistration.v2";
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

export type PushClaimSnapshot = CleanupPushSnapshot & {
  ownerUserId: string;
  mayExist: true;
};

export type PushRegistrationEvidence = {
  mayBeRegistered: boolean;
  /** False means the marker store could not be inspected; fail closed. */
  readable: boolean;
};

export type PushIdentityRead = {
  status: "available" | "confirmed-none" | "unavailable";
  identity: PushIdentity | null;
  ownerUserId?: string;
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
let currentIdentityOwnerUserId: string | undefined;

const pushTokenIdStorage: PushTokenIdStorage = {
  set: (id) => SecureStore.setItemAsync(PUSH_TOKEN_ID_KEY, id),
  delete: () => SecureStore.deleteItemAsync(PUSH_TOKEN_ID_KEY),
};

const pushEvidenceStorage: PushTokenIdStorage = {
  set: (value) => AsyncStorage.setItem(PUSH_MAYBE_REGISTERED_KEY, value),
  delete: () => AsyncStorage.removeItem(PUSH_MAYBE_REGISTERED_KEY),
};

const pushClaimSnapshotStorage: PushTokenIdStorage = {
  set: (value) => SecureStore.setItemAsync(PUSH_CLAIM_SNAPSHOT_KEY, value),
  delete: () => SecureStore.deleteItemAsync(PUSH_CLAIM_SNAPSHOT_KEY),
};

/**
 * Read the previously-stored server-issued token id, if any. Used by the
 * Settings screen to POST prefs updates against the right token.
 */
export async function getStoredTokenId(): Promise<string | null> {
  try {
    if (!(await waitForPushTokenIdMutation(pushTokenIdStorage, SECURE_STORE_TIMEOUT_MS))) {
      return null;
    }
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
    if (!(await waitForPushTokenIdMutation(pushTokenIdStorage, SECURE_STORE_TIMEOUT_MS))) {
      return { tokenId: null, readable: false };
    }
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

/**
 * This record is the cleanup identity of last resort. Unlike a fresh Expo
 * lookup it remains usable after iOS permission is denied or the OS token API
 * is unavailable. It is retained until server revocation and local cleanup
 * have both been verified.
 */
export async function readPushClaimSnapshot(): Promise<{
  snapshot: PushClaimSnapshot | null;
  readable: boolean;
}> {
  try {
    if (!(await waitForPushTokenIdMutation(pushClaimSnapshotStorage, SECURE_STORE_TIMEOUT_MS))) {
      return { snapshot: null, readable: false };
    }
    const raw = await withTimeout(
      SecureStore.getItemAsync(PUSH_CLAIM_SNAPSHOT_KEY),
      SECURE_STORE_TIMEOUT_MS,
      "push claim snapshot read timed out",
    );
    if (raw === null) return { snapshot: null, readable: true };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("invalid push snapshot");
    const candidate = parsed as Partial<PushClaimSnapshot>;
    if (
      typeof candidate.ownerUserId !== "string" ||
      typeof candidate.expoToken !== "string" ||
      !candidate.expoToken ||
      candidate.mayExist !== true
    ) {
      throw new Error("invalid push snapshot");
    }
    if (
      (candidate.deviceId !== undefined && typeof candidate.deviceId !== "string") ||
      (candidate.tokenId !== undefined && typeof candidate.tokenId !== "string")
    ) {
      throw new Error("invalid push snapshot");
    }
    return { snapshot: candidate as PushClaimSnapshot, readable: true };
  } catch {
    return { snapshot: null, readable: false };
  }
}

async function writePushClaimSnapshot(
  snapshot: PushClaimSnapshot,
  isCurrent: () => boolean,
): Promise<boolean> {
  const raw = JSON.stringify(snapshot);
  const persisted = await persistPushTokenId(
    pushClaimSnapshotStorage,
    raw,
    isCurrent,
    SECURE_STORE_TIMEOUT_MS,
  );
  if (!persisted) return false;
  const verify = await readPushClaimSnapshot();
  return verify.readable && JSON.stringify(verify.snapshot) === raw;
}

/** A non-secret durable marker that a server row may exist without its id. */
export async function markPushRegistrationEvidence(): Promise<boolean> {
  return persistPushTokenId(pushEvidenceStorage, "1", () => true, SECURE_STORE_TIMEOUT_MS);
}

export async function readPushRegistrationEvidence(): Promise<PushRegistrationEvidence> {
  try {
    if (!(await waitForPushTokenIdMutation(pushEvidenceStorage, SECURE_STORE_TIMEOUT_MS))) {
      return { mayBeRegistered: true, readable: false };
    }
    const value = await withTimeout(
      AsyncStorage.getItem(PUSH_MAYBE_REGISTERED_KEY),
      SECURE_STORE_TIMEOUT_MS,
      "push registration evidence read timed out",
    );
    return { mayBeRegistered: value === "1", readable: true };
  } catch {
    return { mayBeRegistered: true, readable: false };
  }
}

async function clearPushRegistrationEvidence(): Promise<void> {
  await deletePersistedPushTokenId(pushEvidenceStorage, SECURE_STORE_TIMEOUT_MS);
  const marker = await withTimeout(
    AsyncStorage.getItem(PUSH_MAYBE_REGISTERED_KEY),
    SECURE_STORE_TIMEOUT_MS,
    "push registration evidence verify timed out",
  );
  if (marker !== null) throw new Error("push registration evidence was not cleared");
}

async function clearStoredTokenIdAuthoritatively(): Promise<void> {
  // Marker first: if this fails, retain every claimant value so a retry or a
  // reboot still has enough evidence to attempt server revocation.
  await clearPushRegistrationEvidence();
  await deletePersistedPushTokenId(pushTokenIdStorage, SECURE_STORE_TIMEOUT_MS);
  const tokenId = await withTimeout(
    SecureStore.getItemAsync(PUSH_TOKEN_ID_KEY),
    SECURE_STORE_TIMEOUT_MS,
    "push token id verify timed out",
  );
  if (tokenId !== null) throw new Error("push token id was not cleared");
  await deletePersistedPushTokenId(pushClaimSnapshotStorage, SECURE_STORE_TIMEOUT_MS);
  const snapshot = await readPushClaimSnapshot();
  if (!snapshot.readable || snapshot.snapshot !== null) {
    throw new Error("push claim snapshot was not cleared");
  }
}

async function rollbackRegistration(identity: PushIdentity, tokenId: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_IO_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/v1/push/revoke-device`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        token: identity.expoToken,
        deviceId: identity.deviceId,
        tokenId,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    // A stale id or claimant mismatch must not be treated as proof that the
    // current claimant was revoked. Idempotent already-revoked is safe.
    return isSuccessfulPushRevocation(body);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Clear the account-scoped server token id after a successful unlink. */
export async function clearStoredTokenId(): Promise<void> {
  await clearStoredTokenIdAuthoritatively();
  currentIdentity = null;
  currentIdentityOwnerUserId = undefined;
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
export async function getCurrentPushIdentity(): Promise<PushIdentityRead> {
  if (currentIdentity) {
    return {
      identity: currentIdentity,
      status: "available",
      ...(currentIdentityOwnerUserId ? { ownerUserId: currentIdentityOwnerUserId } : {}),
    };
  }
  if (!Device.isDevice) return { identity: null, status: "confirmed-none" };
  try {
    const permission = await withTimeout(
      Notifications.getPermissionsAsync(),
      PUSH_IO_TIMEOUT_MS,
      "Notification permission check timed out",
    );
    if (permission.status !== "granted") {
      return { identity: null, status: "confirmed-none" };
    }
    const result = await withTimeout(
      Notifications.getExpoPushTokenAsync({ projectId: EXPO_PROJECT_ID }),
      PUSH_IO_TIMEOUT_MS,
      "Expo token lookup timed out",
    );
    if (!result.data) return { identity: null, status: "unavailable" };
    const identity: PushIdentity = { expoToken: result.data };
    try {
      identity.deviceId = await withTimeout(
        getDeviceId(),
        PUSH_IO_TIMEOUT_MS,
        "Device id timed out",
      );
    } catch {
      // Without the server-issued id, the Expo token alone is not a safe
      // claimant proof; sign-out remains fail-closed until it can recover one.
    }
    currentIdentity = identity;
    return { identity, status: "available" };
  } catch {
    return { identity: null, status: "unavailable" };
  }
}

// Kept as an internal compatibility alias for callers that used the earlier
// read-prefixed name; unlike the old boolean shape, it preserves unavailable
// versus confirmed-none for cleanup policy decisions.
export const readCurrentPushIdentity = getCurrentPushIdentity;

/**
 * Full registration flow. Returns null on simulator or when the platform has
 * no push support (e.g. unsupported Android device without Google Play services).
 */
export async function registerForPush(
  session: { token: string; userId: string } | null,
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
    const identity: PushIdentity = { expoToken, ...(deviceId ? { deviceId } : {}) };
    currentIdentity = identity;
    currentIdentityOwnerUserId = session.userId;
    const baseSnapshot: PushClaimSnapshot = {
      ownerUserId: session.userId,
      expoToken,
      mayExist: true,
      ...(deviceId ? { deviceId } : {}),
    };
    // Persist claimant identity before the server write. If the app is killed
    // after POST /register but before the id write, expired-session recovery
    // still has the Expo/device proof and the owning account id.
    if (!(await writePushClaimSnapshot(baseSnapshot, isCurrent)) || !isCurrent()) return null;
    if (!(await markPushRegistrationEvidence()) || !isCurrent()) return null;
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
      const withTokenId = { ...baseSnapshot, tokenId: j.id };
      // Once the server has acknowledged the row, preserve this claimant
      // snapshot even if a newer auth generation cancelled the caller. The
      // queued revocation needs A's proof; deleting it on a stale completion
      // would leave only an anonymous marker.
      if (!(await writePushClaimSnapshot(withTokenId, () => true))) return null;
      const persisted = await persistPushTokenId(
        pushTokenIdStorage,
        j.id,
        isCurrent,
        SECURE_STORE_TIMEOUT_MS,
      );
      if (!persisted) {
        // The API may already have committed the row even when keychain write
        // timed out. Roll it back with the just-issued claimant id; if that
        // cannot be proven, retain the durable marker and fail closed.
        if (await rollbackRegistration(identity, j.id)) await clearStoredTokenId();
        return null;
      }
      if (!isCurrent()) return null;
      return { tokenId: j.id, expoToken, permissionGranted };
    } catch {
      return null;
    }
  });
}
