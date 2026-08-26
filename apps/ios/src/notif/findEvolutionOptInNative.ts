/** Native bindings for the pure Find evolution enrollment helpers. */
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  type FindEvolutionDevicePrefs,
  type FindEvolutionDevicePrefsDependencies,
  type FindEvolutionOptInDependencies,
  type FindEvolutionOptInResult,
  type NotificationSession,
  findEvolutionNudgeDismissalKey,
  getFindEvolutionDevicePrefs as getDevicePrefs,
  serializeFindEvolutionOptIn as serializeOptIn,
} from "./findEvolutionOptIn";
import { getPushPrefs, setPushPref } from "./prefs";
import { ensurePermissions, getStoredTokenId, registerForPush } from "./registerForPush";

const liveDevicePrefsDependencies: FindEvolutionDevicePrefsDependencies = {
  readStoredTokenId: getStoredTokenId,
  readPushPrefs: getPushPrefs,
};

const liveOptInDependencies: FindEvolutionOptInDependencies = {
  requestPermission: ensurePermissions,
  register: (session) => registerForPush(session, { requestPermission: false }),
  persist: setPushPref,
  readPrefs: async (tokenId, session) => {
    const remote = await getPushPrefs(session, tokenId);
    if (remote.tokenId !== tokenId)
      throw new Error("This device push token is no longer available");
    return remote.prefs;
  },
};

/** `null` means storage was unavailable; callers should fail closed and hide the nudge. */
export async function readFindEvolutionNudgeDismissal(userId: string): Promise<boolean | null> {
  try {
    return (await AsyncStorage.getItem(findEvolutionNudgeDismissalKey(userId))) === "1";
  } catch {
    return null;
  }
}

/** Returns false when storage was unavailable, while leaving the current card dismissible. */
export async function dismissFindEvolutionNudge(userId: string): Promise<boolean> {
  try {
    await AsyncStorage.setItem(findEvolutionNudgeDismissalKey(userId), "1");
    return true;
  } catch {
    return false;
  }
}

export function getFindEvolutionDevicePrefs(
  session: NotificationSession,
): Promise<FindEvolutionDevicePrefs> {
  return getDevicePrefs(session, liveDevicePrefsDependencies);
}

export function serializeFindEvolutionOptIn(
  session: NotificationSession,
  isCurrent: () => boolean,
): () => Promise<FindEvolutionOptInResult> {
  return serializeOptIn(session, { ...liveOptInDependencies, isCurrent });
}
