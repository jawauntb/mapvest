import { describe, expect, test } from "bun:test";
import {
  PUSH_ACTION_IDS,
  type PushNotificationDelivery,
  parsePushNotificationDelivery,
  pathFromPushDelivery,
  pushDeliveryAdmissionReason,
} from "./delivery";

const NOW = Date.parse("2026-09-01T16:00:00.000Z");

function delivery(over: Partial<PushNotificationDelivery> = {}): PushNotificationDelivery {
  return {
    schemaVersion: 1,
    deliveryId: "claim-one",
    installationId: "push-phone",
    issuedAt: "2026-09-01T15:59:00.000Z",
    expiresAt: "2026-09-01T17:00:00.000Z",
    eventKind: "uncaught_nearby",
    target: {
      type: "map",
      placeId: "place-one",
      ticker: "JPM",
      lat: 40.7411,
      lng: -73.9897,
      label: "JPMorgan Chase",
      reason: "It matches companies you explore.",
    },
    ...over,
  };
}

describe("push delivery parsing and admission", () => {
  test("accepts a current installation-scoped delivery", () => {
    const parsed = parsePushNotificationDelivery({ mapvest: delivery() });
    expect(parsed).toEqual(delivery());
    expect(
      pushDeliveryAdmissionReason({
        delivery: parsed,
        installationId: "push-phone",
        currentAccountId: "user-one",
        claimOwnerAccountId: "user-one",
        entries: {},
        nowMs: NOW,
      }),
    ).toBe("accepted");
  });

  test("fails closed for malformed, expired, future, mismatched, and replayed deliveries", () => {
    const common = {
      installationId: "push-phone",
      currentAccountId: "user-one",
      claimOwnerAccountId: "user-one",
      entries: {},
      nowMs: NOW,
    };
    expect(parsePushNotificationDelivery({ kind: "uncaught_nearby" })).toBeNull();
    expect(pushDeliveryAdmissionReason({ delivery: null, ...common })).toBe("malformed");
    expect(
      pushDeliveryAdmissionReason({
        delivery: delivery({ expiresAt: "2026-09-01T15:00:00.000Z" }),
        ...common,
      }),
    ).toBe("expired");
    expect(
      pushDeliveryAdmissionReason({
        delivery: delivery({ issuedAt: "2026-09-01T16:06:00.000Z" }),
        ...common,
      }),
    ).toBe("not-yet-valid");
    expect(
      pushDeliveryAdmissionReason({
        delivery: delivery({ installationId: "push-tablet" }),
        ...common,
      }),
    ).toBe("installation-mismatch");
    expect(
      pushDeliveryAdmissionReason({
        delivery: delivery(),
        ...common,
        claimOwnerAccountId: "user-two",
      }),
    ).toBe("account-mismatch");
    expect(
      pushDeliveryAdmissionReason({
        delivery: delivery(),
        ...common,
        entries: {
          "claim-one": {
            delivery: delivery(),
            status: "handled",
            admittedAt: "2026-09-01T16:00:00.000Z",
          },
        },
      }),
    ).toBe("duplicate");
    expect(
      pushDeliveryAdmissionReason({
        delivery: delivery({ deliveryId: "claim-two" }),
        ...common,
        limit: 1,
        entries: {
          "claim-one": {
            delivery: delivery(),
            status: "pending",
            admittedAt: "2026-09-01T16:00:00.000Z",
          },
        },
      }),
    ).toBe("capacity");
  });
});

describe("push delivery routing", () => {
  test("preserves the intended map destination and foreground action routes", () => {
    const path = pathFromPushDelivery(delivery());
    expect(path).toContain("/(tabs)/map?");
    expect(path).toContain("placeId=place-one");
    expect(path).toContain("ticker=JPM");
    expect(path).toContain("deliveryId=claim-one");
    expect(pathFromPushDelivery(delivery(), PUSH_ACTION_IDS.viewCompany)).toBe("/detail/JPM");
    expect(pathFromPushDelivery(delivery(), PUSH_ACTION_IDS.settings)).toBe("/(tabs)/settings");
  });

  test("routes every typed destination without using legacy kind strings", () => {
    expect(pathFromPushDelivery(delivery({ target: { type: "company", ticker: "NVDA" } }))).toBe(
      "/detail/NVDA",
    );
    expect(pathFromPushDelivery(delivery({ target: { type: "research" } }))).toBe(
      "/(tabs)/research",
    );
    expect(pathFromPushDelivery(delivery({ target: { type: "universe" } }))).toBe("/universe");
  });
});
