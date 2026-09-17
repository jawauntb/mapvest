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
