/**
 * Ownership rules for a Camera identify result. The camera stays mounted
 * across auth changes, so an in-flight guest or prior-account response must
 * never become visible to the account that is now active.
 */
export type CameraResultScope = "guest" | `user:${string}`;

export function cameraResultScope(userId?: string | null): CameraResultScope {
  const normalizedUserId = userId?.trim();
  return normalizedUserId ? `user:${normalizedUserId}` : "guest";
}

export function cameraResultCacheKey(scope: CameraResultScope) {
  return ["tab-state", "camera", scope] as const;
}

/** A response may update the UI only while its initiating identity is live. */
export function canApplyCameraResult(
  initiatingScope: CameraResultScope,
  activeScope: CameraResultScope,
): boolean {
  return initiatingScope === activeScope;
}
