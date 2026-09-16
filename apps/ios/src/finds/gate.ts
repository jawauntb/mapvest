/** Guest unlock written after a primary Investable renders on Camera. */
export const FIRST_FIND_STORAGE_KEY = "mapvest.firstFind.v1";
export const FIRST_FIND_FLAG_VALUE = "1";
export const firstFindFlagQueryKey = ["first-find-guest-flag"] as const;

/**
 * First-run ritual unlock. True when this session/device has ever completed
 * a successful identify: either `listFinds()` returned ≥1 row, or the guest
 * flag is the stored `"1"`.
 *
 * Callers must fail closed on storage errors — pass `guestFlag: null` when
 * the read throws (see `readGuestFlag`).
 */
export function hasFirstFind({
  finds,
  guestFlag,
}: {
  finds: readonly unknown[] | null | undefined;
  guestFlag: string | null | undefined;
}): boolean {
  if ((finds?.length ?? 0) >= 1) return true;
  return guestFlag === FIRST_FIND_FLAG_VALUE;
}

/** Fail-closed adapter: a throwing storage read never unlocks the gate. */
export function readGuestFlag(read: () => string | null): string | null {
  try {
    return read();
  } catch {
    return null;
  }
}
