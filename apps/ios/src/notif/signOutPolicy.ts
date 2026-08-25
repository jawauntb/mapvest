/**
 * Account-switch privacy policy for one physical installation.
 *
 * This module stays free of Expo/React Native imports so the failure policy is
 * unit-testable: do not clear an authenticated session while a known (or
 * unreadable) push token has no successful server revocation path.
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
  unlinkServer?: () => Promise<void>;
  /** Identity fallback works without a valid bearer or stored token id. */
  unlinkServerByIdentity?: () => Promise<void>;
  /** True when native identity lookup found an Expo token. */
  hasPhysicalIdentity?: boolean;
  unregisterNative: () => Promise<void>;
  dismissNative: () => Promise<void>;
  clearStoredTokenId: () => Promise<void>;
};

export type PushSignOutResult = {
  serverUnlinked: boolean;
  nativeUnregistered: boolean;
};

// Sign-out must remain a bounded, retryable UI action. The underlying network
// wrappers also abort at 8s, but this policy gives each cleanup attempt a
// shorter upper bound so a dead native bridge cannot strand the session.
const OPERATION_TIMEOUT_MS = 1_000;

async function attempted(operation: (() => Promise<void>) | undefined): Promise<boolean> {
  if (!operation) return false;
  try {
    await Promise.race([
      operation(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("push cleanup timed out")), OPERATION_TIMEOUT_MS),
      ),
    ]);
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
    Boolean(dependencies.unlinkServerByIdentity) ||
    Boolean(dependencies.hasPhysicalIdentity);
  let serverUnlinked = false;
  if (dependencies.tokenId && dependencies.unlinkServer) {
    serverUnlinked = await attempted(dependencies.unlinkServer);
  }
  if (!serverUnlinked && dependencies.unlinkServerByIdentity) {
    serverUnlinked = await attempted(dependencies.unlinkServerByIdentity);
  }
  const nativeUnregistered = await attempted(dependencies.unregisterNative);
  await attempted(dependencies.dismissNative);

  // Native unregistration only stops future local delivery. It cannot revoke
  // a server row, so it never substitutes for server cleanup when a token is
  // known or a physical identity was available.
  if (serverRequired && !serverUnlinked) {
    throw new PushSignOutRevocationError();
  }

  // Only clear the opaque server id once the installation is either known not
  // to have one or a revocation path succeeded. On failure it remains in
  // SecureStore so the still-authenticated Settings/Admin screen can retry.
  await dependencies.clearStoredTokenId();
  return { serverUnlinked, nativeUnregistered };
}
