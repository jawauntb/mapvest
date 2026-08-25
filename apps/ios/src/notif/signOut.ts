/**
 * Native adapter for the push sign-out policy. It runs while the bearer
 * session still exists when available; SessionProvider clears that session
 * only after this function resolves. Public fallback always needs claimant
 * proof, while a valid bearer may identify the current account by Expo token.
 */
import * as Notifications from "expo-notifications";

import { unlinkPushToken, unlinkPushTokenByIdentity } from "./prefs";
import {
  clearStoredTokenId,
  getCurrentPushIdentity,
  readPushRegistrationEvidence,
  readStoredTokenIdForSignOut,
} from "./registerForPush";
import { revokePushForSignOut } from "./signOutPolicy";

type NotificationCleanup = {
  setAutoServerRegistrationEnabledAsync?: (enabled: boolean) => Promise<void>;
  unregisterForNotificationsAsync?: () => Promise<void>;
  dismissAllNotificationsAsync?: () => Promise<void>;
  clearLastNotificationResponseAsync?: () => Promise<void>;
};

const cleanup = Notifications as typeof Notifications & NotificationCleanup;
const AUTO_REGISTRATION_TIMEOUT_MS = 1_000;

async function disableExpoAutoRegistration(): Promise<void> {
  const disable = cleanup.setAutoServerRegistrationEnabledAsync;
  if (!disable) return;
  try {
    await Promise.race([
      disable(false),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Expo auto-registration shutdown timed out")),
          AUTO_REGISTRATION_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch {
    // This is defense in depth only. Server revocation below remains the
    // authoritative cleanup proof and is still required when evidence exists.
  }
}

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

export async function unlinkPushForSignOut(
  session?: { token: string },
  options: { authenticatedBearer: boolean } = {
    authenticatedBearer: Boolean(session),
  },
): Promise<void> {
  // getExpoPushTokenAsync enables Expo's automatic token registration as a
  // side effect. Disable it before identity recovery and again in the policy
  // immediately before native cleanup so sign-out cannot re-arm delivery.
  await disableExpoAutoRegistration();
  const stored = await readStoredTokenIdForSignOut();
  const identityRead = await getCurrentPushIdentity();
  const identity = identityRead.identity;
  const evidence = await readPushRegistrationEvidence();
  await revokePushForSignOut({
    tokenId: stored.tokenId,
    tokenStorageReadable: stored.readable,
    registrationEvidenceReadable: evidence.readable,
    mayBeRegistered: evidence.mayBeRegistered,
    physicalIdentityStatus: identityRead.status,
    unlinkServer:
      stored.tokenId && session
        ? () => unlinkPushToken(stored.tokenId!, { token: session.token })
        : undefined,
    // A valid bearer can prove the current account when SecureStore lost its
    // id; an expired/invalid bearer is deliberately not allowed to fall back
    // to token-only public revocation.
    unlinkServerByIdentity:
      identity && (stored.tokenId || (options.authenticatedBearer && session))
        ? () =>
            unlinkPushTokenByIdentity(
              identity,
              stored.tokenId,
              options.authenticatedBearer ? session : undefined,
            )
        : undefined,
    disableAutoRegistration: disableExpoAutoRegistration,
    unregisterNative: unregisterNativePush,
    dismissNative: dismissNativeNotifications,
    clearStoredTokenId,
  });
}
