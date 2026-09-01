/**
 * Expo reports top-level notification authorization separately from the iOS
 * alert presentation setting. A granted status without alerts cannot deliver
 * the Find evolution notification the UI is offering.
 */
export type NotificationPermissionSnapshot = {
  status?: string | null;
  ios?: { status?: number | null; allowsAlert?: boolean | null } | null;
};

const IOS_AUTHORIZATION_STATUS = {
  authorized: 2,
  provisional: 3,
  ephemeral: 4,
} as const;

export function allowsNotificationAlerts(
  permissions: NotificationPermissionSnapshot,
  platform: string,
): boolean {
  if (platform !== "ios") return permissions.status === "granted";

  const iosStatus = permissions.ios?.status;
  if (
    iosStatus === IOS_AUTHORIZATION_STATUS.provisional ||
    iosStatus === IOS_AUTHORIZATION_STATUS.ephemeral
  ) {
    return true;
  }
  if (permissions.status !== "granted" && iosStatus !== IOS_AUTHORIZATION_STATUS.authorized) {
    return false;
  }
  return permissions.ios?.allowsAlert === true;
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
