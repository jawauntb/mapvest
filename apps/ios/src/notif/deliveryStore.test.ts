import { describe, expect, test } from "bun:test";
import type { PushNotificationDelivery } from "./delivery";
import { type PushDeliveryStorage, createPushDeliveryStore } from "./deliveryStore";

const NOW = Date.parse("2026-09-01T16:00:00.000Z");

function memoryStorage(): PushDeliveryStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
}

function data(id: string, installationId = "push-phone") {
  const delivery: PushNotificationDelivery = {
    schemaVersion: 1,
    deliveryId: id,
    installationId,
    issuedAt: "2026-09-01T15:59:00.000Z",
    expiresAt: "2026-09-01T17:00:00.000Z",
    eventKind: "daily_brief",
    target: { type: "home", section: "daily-brief" },
  };
  return { mapvest: delivery };
}

const scope = {
  accountId: "user-one",
  claimOwnerAccountId: "user-one",
  installationId: "push-phone",
};

describe("push delivery replay store", () => {
  test("writes pending before route and handled only after handoff", async () => {
    const storage = memoryStorage();
    const store = createPushDeliveryStore(storage);
    expect(await store.admit(data("claim-one"), scope, NOW)).toMatchObject({ accepted: true });
    expect((await store.pending(scope, NOW)).map((item) => item.deliveryId)).toEqual(["claim-one"]);
    expect(await store.markHandled("claim-one", scope, NOW + 1)).toBe(true);
    expect(await store.pending(scope, NOW + 1)).toEqual([]);
    expect(await store.admit(data("claim-one"), scope, NOW + 2)).toEqual({
      accepted: false,
      reason: "duplicate",
    });
  });

  test("retains pending work for startup retry and clears it on account or installation change", async () => {
    const storage = memoryStorage();
    const first = createPushDeliveryStore(storage);
    await first.admit(data("claim-pending"), scope, NOW);
    const afterRestart = createPushDeliveryStore(storage);
    expect((await afterRestart.pending(scope, NOW)).map((item) => item.deliveryId)).toEqual([
      "claim-pending",
    ]);
    await afterRestart.activateScope({ accountId: "user-two", installationId: "push-tablet" });
    expect(
      await afterRestart.pending({ accountId: "user-two", installationId: "push-tablet" }, NOW),
    ).toEqual([]);
  });

  test("rejects a corrupt ledger once instead of routing without replay protection", async () => {
    const storage = memoryStorage();
    storage.values.set("mapvest.pushDeliveryLedger.v1", "{broken");
    const store = createPushDeliveryStore(storage);
    await expect(
      store.activateScope({ accountId: scope.accountId, installationId: scope.installationId }),
    ).rejects.toThrow("has been reset");
    expect(await store.admit(data("claim-one"), scope, NOW)).toMatchObject({ accepted: true });
  });
});
