import type { CleanupPushSnapshot } from "@/auth/sessionController";
/**
 * Native adapter for the push sign-out policy. It runs while the bearer
 * session still exists when available; SessionProvider clears that session
 * only after this function resolves. Public fallback always needs claimant
 * proof, while a valid bearer may identify the current account by Expo token.
 */
import * as Notifications from "expo-notifications";

import { disableVisitMonitoring } from "@/location/visits";
import { clearWidgetLocationState } from "@/widgets/widgetLocation";
import {
  unlinkPushToken,
  unlinkPushTokenByExpiredSession,
  unlinkPushTokenByIdentity,
} from "./prefs";
import {
  clearStoredTokenId,
  getCurrentPushIdentity,
  readPushClaimSnapshot,
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

/**
 * Notification opt-out is a confirmed privacy boundary, not just a server
 * preference. Stop native visits and remove the widget's pending location
 * before the UI reports delivery disabled.
 */
export async function cleanupLocationAfterNotificationOptOut(): Promise<void> {
  await disableVisitMonitoring();
  await clearWidgetLocationState();
}

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
  session?: { token: string; userId?: string },
  options: {
    authenticatedBearer: boolean;
    recoverySession?: boolean;
    ownerUserId?: string;
    pushSnapshot?: CleanupPushSnapshot;
  } = { authenticatedBearer: Boolean(session), recoverySession: false },
): Promise<void> {
  // getExpoPushTokenAsync enables Expo's automatic token registration as a
  // side effect. Disable it before identity recovery and again in the policy
  // immediately before native cleanup so sign-out cannot re-arm delivery.
  await disableExpoAutoRegistration();
  const stored = await readStoredTokenIdForSignOut();
  const persisted = options.pushSnapshot
    ? { snapshot: options.pushSnapshot, readable: true }
    : await readPushClaimSnapshot();
  // A persisted v2 snapshot (or an old opaque id during expired-session
  // recovery) is sufficient proof. Avoid getExpoPushTokenAsync here: on iOS it
  // is permission-gated and also re-enables Expo auto-registration.
  const identityRead =
    persisted.snapshot ||
    (options.recoverySession && (stored.tokenId || persisted.readable === false))
      ? {
          identity: null,
          status: persisted.snapshot ? ("available" as const) : ("unavailable" as const),
        }
      : await getCurrentPushIdentity();
  // Permission-gated OS lookup is only a fallback. A persisted snapshot is
  // authoritative even when iOS now reports denied/unavailable.
  const identity = persisted.snapshot
    ? {
        expoToken: persisted.snapshot.expoToken,
        ...(persisted.snapshot.deviceId ? { deviceId: persisted.snapshot.deviceId } : {}),
      }
    : identityRead.identity;
  const tokenId = stored.tokenId ?? persisted.snapshot?.tokenId ?? null;
  const ownerUserId =
    persisted.snapshot?.ownerUserId ?? identityRead.ownerUserId ?? options.ownerUserId;
  const bearerOwnerMatches =
    Boolean(session) && (!ownerUserId || !session?.userId || ownerUserId === session.userId);
  const evidence = await readPushRegistrationEvidence();
  await revokePushForSignOut({
    tokenId,
    tokenStorageReadable: stored.readable && persisted.readable,
    registrationEvidenceReadable: evidence.readable && persisted.readable,
    mayBeRegistered: evidence.mayBeRegistered || Boolean(persisted.snapshot) || !persisted.readable,
    physicalIdentityStatus: persisted.snapshot ? "available" : identityRead.status,
    unlinkServer:
      tokenId && session && bearerOwnerMatches
        ? () => unlinkPushToken(tokenId, { token: session.token })
        : undefined,
    // A valid bearer can prove the current account when SecureStore lost its
    // id; an expired/invalid bearer is deliberately not allowed to fall back
    // to token-only public revocation.
    unlinkServerByIdentity:
      identity &&
      (tokenId ||
        (options.authenticatedBearer && session && bearerOwnerMatches) ||
        (options.recoverySession && session && bearerOwnerMatches))
        ? () => {
            if (options.recoverySession && session) {
              return unlinkPushTokenByExpiredSession(identity, session, tokenId);
            }
            if (tokenId) return unlinkPushTokenByIdentity(identity, tokenId);
            if (options.authenticatedBearer && session) {
              return unlinkPushTokenByIdentity(identity, undefined, session);
            }
            return Promise.reject(new Error("No claimant-bound push proof"));
          }
        : options.recoverySession && session && bearerOwnerMatches && tokenId
          ? () => unlinkPushTokenByExpiredSession(null, session, tokenId)
          : undefined,
    disableAutoRegistration: disableExpoAutoRegistration,
    unregisterNative: unregisterNativePush,
    dismissNative: dismissNativeNotifications,
    clearStoredTokenId,
  });

  // SessionController only deletes the session after this function resolves,
  // so confirmed cleanup cannot leave a background visit task or a widget fix
  // that a later account could relay.
  await cleanupLocationAfterNotificationOptOut();
}
