/**
 * Native adapter for the push sign-out policy. It runs while the bearer
 * session still exists; SessionProvider clears that session only after this
 * function resolves.
 */
import * as Notifications from "expo-notifications";

import { unlinkPushToken } from "./prefs";
import { clearStoredTokenId, readStoredTokenIdForSignOut } from "./registerForPush";
import { revokePushForSignOut } from "./signOutPolicy";

type NotificationCleanup = {
  unregisterForNotificationsAsync?: () => Promise<void>;
  dismissAllNotificationsAsync?: () => Promise<void>;
  clearLastNotificationResponseAsync?: () => Promise<void>;
};

const cleanup = Notifications as typeof Notifications & NotificationCleanup;

function unregisterNativePush(): Promise<void> {
  if (!cleanup.unregisterForNotificationsAsync) {
    return Promise.reject(new Error("Native push unregistration is unavailable"));
  }
  return cleanup.unregisterForNotificationsAsync();
}

async function dismissNativeNotifications(): Promise<void> {
  // A stale notification response must not route a new account into an old
  // account's context after sign-out. Each API is best-effort and platform
  // dependent, so run both without making dismissal hide a revoke failure.
  await Promise.allSettled([
    cleanup.dismissAllNotificationsAsync?.(),
    cleanup.clearLastNotificationResponseAsync?.(),
  ]);
}

export async function unlinkPushForSignOut(session: { token: string }): Promise<void> {
  const stored = await readStoredTokenIdForSignOut();
  await revokePushForSignOut({
    tokenId: stored.tokenId,
    tokenStorageReadable: stored.readable,
    unlinkServer: stored.tokenId
      ? () => unlinkPushToken(stored.tokenId!, { token: session.token })
      : undefined,
    unregisterNative: unregisterNativePush,
    dismissNative: dismissNativeNotifications,
    clearStoredTokenId,
  });
}
