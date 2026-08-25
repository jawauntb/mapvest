/** Pure session lifecycle decisions used by boot and background refresh. */
export function sessionExpired(expiresAt: string, now = Date.now()): boolean {
  const at = new Date(expiresAt).getTime();
  return !Number.isFinite(at) || at < now;
}

export function authFailureNeedsPushCleanup(status: number): boolean {
  return status === 401;
}

export function secureStoreReadNeedsPushCleanup(timedOut: boolean): boolean {
  return timedOut;
}
