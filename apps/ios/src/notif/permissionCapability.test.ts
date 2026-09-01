import { describe, expect, test } from "bun:test";

import {
  allowsNotificationAlerts,
  notificationAlertPermissionStatus,
} from "./permissionCapability";

describe("notification alert capability", () => {
  test("requires the iOS alert capability in addition to granted status", () => {
    expect(allowsNotificationAlerts({ status: "granted", ios: { allowsAlert: true } }, "ios")).toBe(
      true,
    );
    expect(
      allowsNotificationAlerts({ status: "granted", ios: { allowsAlert: false } }, "ios"),
    ).toBe(false);
    expect(
      notificationAlertPermissionStatus({ status: "granted", ios: { allowsAlert: false } }, "ios"),
    ).toBe("denied");
  });

  test("keeps the existing granted behavior on non-iOS platforms", () => {
    expect(allowsNotificationAlerts({ status: "granted" }, "android")).toBe(true);
    expect(allowsNotificationAlerts({ status: "denied" }, "android")).toBe(false);
  });

  test("treats provisional and ephemeral iOS authorization as usable", () => {
    expect(
      allowsNotificationAlerts(
        { status: "undetermined", ios: { status: 3, allowsAlert: false } },
        "ios",
      ),
    ).toBe(true);
    expect(
      notificationAlertPermissionStatus(
        { status: "undetermined", ios: { status: 4, allowsAlert: false } },
        "ios",
      ),
    ).toBe("granted");
  });

  test("accepts the authorized iOS enum only when alert presentation is enabled", () => {
    expect(
      allowsNotificationAlerts(
        { status: "undetermined", ios: { status: 2, allowsAlert: true } },
        "ios",
      ),
    ).toBe(true);
    expect(
      allowsNotificationAlerts(
        { status: "undetermined", ios: { status: 2, allowsAlert: false } },
        "ios",
      ),
    ).toBe(false);
  });
});
