/**
 * Account-switch privacy policy for one physical installation.
 *
 * This module stays free of Expo/React Native imports so the failure policy is
 * unit-testable: do not clear an authenticated session while a known (or
 * unreadable) push token has no successful server or native revocation path.
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
  unregisterNative: () => Promise<void>;
  dismissNative: () => Promise<void>;
  clearStoredTokenId: () => Promise<void>;
};

export type PushSignOutResult = {
  serverUnlinked: boolean;
  nativeUnregistered: boolean;
};

async function attempted(operation: (() => Promise<void>) | undefined): Promise<boolean> {
  if (!operation) return false;
  try {
    await operation();
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
  const hasOrMayHaveToken = Boolean(dependencies.tokenId) || !dependencies.tokenStorageReadable;
  const [serverUnlinked, nativeUnregistered] = await Promise.all([
    attempted(dependencies.tokenId ? dependencies.unlinkServer : undefined),
    attempted(dependencies.unregisterNative),
  ]);
  await attempted(dependencies.dismissNative);

  if (hasOrMayHaveToken && !serverUnlinked && !nativeUnregistered) {
    throw new PushSignOutRevocationError();
  }

  // Only clear the opaque server id once the installation is either known not
  // to have one or a revocation path succeeded. On failure it remains in
  // SecureStore so the still-authenticated Settings/Admin screen can retry.
  await dependencies.clearStoredTokenId();
  return { serverUnlinked, nativeUnregistered };
}
