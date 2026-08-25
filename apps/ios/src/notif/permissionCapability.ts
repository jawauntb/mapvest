/**
 * Expo reports top-level notification authorization separately from the iOS
 * alert presentation setting. A granted status without alerts cannot deliver
 * the Find evolution notification the UI is offering.
 */
export type NotificationPermissionSnapshot = {
  status?: string | null;
  ios?: { allowsAlert?: boolean | null } | null;
};

export function allowsNotificationAlerts(
  permissions: NotificationPermissionSnapshot,
  platform: string,
): boolean {
  if (permissions.status !== "granted") return false;
  return platform !== "ios" || permissions.ios?.allowsAlert === true;
}

export function notificationAlertPermissionStatus(
  permissions: NotificationPermissionSnapshot,
  platform: string,
): "granted" | "denied" | "undetermined" {
  if (allowsNotificationAlerts(permissions, platform)) return "granted";
  if (permissions.status === "denied") return "denied";
  // iOS may retain top-level authorization while the user disables alert
  // presentation. Treat that as blocked delivery so Settings links them out.
  return platform === "ios" && permissions.status === "granted" ? "denied" : "undetermined";
}
