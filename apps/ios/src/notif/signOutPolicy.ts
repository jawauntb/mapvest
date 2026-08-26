/**
 * Account-switch privacy policy for one physical installation.
 *
 * This module stays free of Expo/React Native imports so the failure policy is
 * unit-testable: do not clear an authenticated session while a known (or
 * unreadable) push token has no successful claimant-bound revocation path.
 */
export class PushSignOutRevocationError extends Error {
  constructor() {
    super(
      "Mapvest could not remove this device from notifications. Check your connection and retry sign out.",
    );
    this.name = "PushSignOutRevocationError";
  }
}

export type PushSignOutDependencies = {
  tokenId: string | null;
  /** False means secure storage could not be inspected, so a token may exist. */
  tokenStorageReadable: boolean;
  /** False means the non-secret registration marker could not be inspected. */
  registrationEvidenceReadable?: boolean;
  /** A registration may have committed while its id write timed out. */
  mayBeRegistered?: boolean;
  unlinkServer?: () => Promise<void>;
  /** Claimant-bound identity fallback; valid bearer may recover a missing id. */
  unlinkServerByIdentity?: () => Promise<void>;
  /** Explicit native identity result; unavailable is not confirmed-none. */
  physicalIdentityStatus?: "available" | "confirmed-none" | "unavailable";
  /** Best-effort defense against Expo re-registering after cleanup starts. */
  disableAutoRegistration?: () => Promise<void>;
  unregisterNative: () => Promise<void>;
  dismissNative: () => Promise<void>;
  clearStoredTokenId: () => Promise<void>;
};

export type PushSignOutResult = {
  serverUnlinked: boolean;
  nativeUnregistered: boolean;
};

// The network wrappers abort at 8s. Keep the policy deadline just beyond that
// boundary so it cannot reject a legitimate in-flight server response first.
// Native APIs get a separate short defense-in-depth bound below.
const SERVER_OPERATION_TIMEOUT_MS = 8_500;
const NATIVE_OPERATION_TIMEOUT_MS = 1_000;

async function attempted(
  operation: (() => Promise<void>) | undefined,
  timeoutMs: number,
): Promise<boolean> {
  if (!operation) return false;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("push cleanup timed out")), timeoutMs);
      Promise.resolve()
        .then(() => operation())
        .then(
          () => {
            clearTimeout(timer);
            resolve();
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error);
          },
        );
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Try both independently useful revocation paths before touching the session.
 * Dismissing visible notifications is always attempted, but is not counted as
 * a delivery revocation because it cannot stop a later remote push.
 */
export async function revokePushForSignOut(
  dependencies: PushSignOutDependencies,
): Promise<PushSignOutResult> {
  const serverRequired =
    Boolean(dependencies.tokenId) ||
    !dependencies.tokenStorageReadable ||
    dependencies.registrationEvidenceReadable === false ||
    Boolean(dependencies.mayBeRegistered) ||
    dependencies.physicalIdentityStatus === "available" ||
    dependencies.physicalIdentityStatus === "unavailable" ||
    Boolean(dependencies.unlinkServerByIdentity);
  let serverUnlinked = false;
  if (dependencies.tokenId && dependencies.unlinkServer) {
    serverUnlinked = await attempted(dependencies.unlinkServer, SERVER_OPERATION_TIMEOUT_MS);
  }
  if (!serverUnlinked && dependencies.unlinkServerByIdentity) {
    serverUnlinked = await attempted(
      dependencies.unlinkServerByIdentity,
      SERVER_OPERATION_TIMEOUT_MS,
    );
  }
  // Expo's native unregister only calls UIApplication's APNs detach method;
  // neither it nor auto-registration shutdown revokes the server claim.
  await attempted(dependencies.disableAutoRegistration, NATIVE_OPERATION_TIMEOUT_MS);
  const nativeUnregistered = await attempted(
    dependencies.unregisterNative,
    NATIVE_OPERATION_TIMEOUT_MS,
  );
  await attempted(dependencies.dismissNative, NATIVE_OPERATION_TIMEOUT_MS);

  // Native cleanup cannot mask a missing server proof. If any evidence says a
  // claim may exist, cleanup remains retry-required until the server confirms
  // revoked or already-revoked.
  if (serverRequired && !serverUnlinked) {
    throw new PushSignOutRevocationError();
  }

  // Only clear the opaque server id once the installation is either known not
  // to have one or a revocation path succeeded. On failure it remains in
  // SecureStore so the still-authenticated Settings/Admin screen can retry.
  await dependencies.clearStoredTokenId();
  return { serverUnlinked, nativeUnregistered };
}
