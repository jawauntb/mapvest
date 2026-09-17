import * as Haptics from "expo-haptics";

/**
 * Thin wrappers around expo-haptics — every call is fire-and-forget and
 * swallow errors (simulators / some Android devices don't support it).
 * Use sparingly per HIG: tab switches, save/star toggles, primary CTA taps.
 */
export function hapticTap() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function hapticSelect() {
  Haptics.selectionAsync().catch(() => {});
}

export function hapticSuccess() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function hapticWarn() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

/**
 * Distinct "confetti-tier" moment for a company's global first capture
 * (capture economy Item 3) — a heavier double-pulse, deliberately more than
 * `hapticSuccess`, and never used for the existing rarity chip (first
 * capture is orthogonal to `DexRarity`, not a fifth tier of it).
 */
export function hapticFirstCapture() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  setTimeout(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  }, 120);
}
