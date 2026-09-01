import { describe, expect, test } from "bun:test";
import { composeWidgetDiscoverySnapshot } from "./widgetSnapshot";
import {
  WidgetSnapshotSessionGate,
  type WidgetSnapshotStorage,
  createWidgetSnapshotStore,
} from "./widgetSnapshotStore";

function memoryStorage(): WidgetSnapshotStorage & { values: Map<string, string>; reloads: number } {
  const values = new Map<string, string>();
  return {
    values,
    reloads: 0,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
    reload: async function () {
      this.reloads += 1;
    },
  };
}

function snapshot(
  scope: { kind: "guest" } | { kind: "account"; accountId: string; epoch: string },
) {
  return composeWidgetDiscoverySnapshot({
    scope,
    location: { status: "fresh", source: "device", label: "Nearby" },
    nearby: [{ name: "JPMorgan Chase", ticker: "JPM", distanceM: 100 }],
    nowMs: Date.parse("2026-09-01T20:00:00.000Z"),
  });
}

describe("widget snapshot lifecycle", () => {
  test("writes one verified account snapshot and preserves its epoch across activation", async () => {
    const storage = memoryStorage();
    let epoch = 0;
    const store = createWidgetSnapshotStore(storage, () => `epoch-${++epoch}`);
    const first = await store.activateAccount("user-one");
    expect(await store.activateAccount("user-one")).toEqual(first);
    expect(
      await store.write(snapshot(first as { kind: "account"; accountId: string; epoch: string })),
    ).toBe(true);
    expect((await store.readSnapshot())?.scope).toEqual(first);
  });

  test("canonicalizes the snapshot before crossing the App Group boundary", async () => {
    const storage = memoryStorage();
    const store = createWidgetSnapshotStore(storage, () => "epoch-one");
    const account = await store.activateAccount("user-one");
    const value = {
      ...snapshot(account as { kind: "account"; accountId: string; epoch: string }),
      accidentalSecret: "do-not-persist",
    };
    expect(await store.write(value)).toBe(true);
    expect(storage.values.get("discoverySnapshotV1")).not.toContain("accidentalSecret");
  });

  test("account switch clears old personal content before activating the new epoch", async () => {
    const storage = memoryStorage();
    let epoch = 0;
    const store = createWidgetSnapshotStore(storage, () => `epoch-${++epoch}`);
    const first = await store.activateAccount("user-one");
    await store.write(snapshot(first as { kind: "account"; accountId: string; epoch: string }));
    const second = await store.activateAccount("user-two");
    expect(second).toMatchObject({ kind: "account", accountId: "user-two" });
    expect(await store.readSnapshot()).toBeNull();
    expect(
      await store.write(snapshot(first as { kind: "account"; accountId: string; epoch: string })),
    ).toBe(false);
  });

  test("account switch fails closed when old snapshot removal fails", async () => {
    const storage = memoryStorage();
    let epoch = 0;
    const store = createWidgetSnapshotStore(storage, () => `epoch-${++epoch}`);
    const first = await store.activateAccount("user-one");
    await store.write(snapshot(first as { kind: "account"; accountId: string; epoch: string }));
    const originalRemove = storage.remove;
    let failed = false;
    storage.remove = async (key) => {
      if (!failed && key === "discoverySnapshotV1") {
        failed = true;
        throw new Error("remove failed");
      }
      await originalRemove(key);
    };

    const second = await store.activateAccount("user-two");
    expect(second).toMatchObject({ kind: "account", accountId: "user-two" });
    expect(await store.readScope()).toEqual(second);
    expect((await store.readSnapshot())?.scope).toEqual(first);
    expect(
      await store.write(snapshot(second as { kind: "account"; accountId: string; epoch: string })),
    ).toBe(true);
    expect((await store.readSnapshot())?.scope).toEqual(second);
  });

  test("account switch erases the old snapshot when the new scope write fails", async () => {
    const storage = memoryStorage();
    let epoch = 0;
    const store = createWidgetSnapshotStore(storage, () => `epoch-${++epoch}`);
    const first = await store.activateAccount("user-one");
    await store.write(snapshot(first as { kind: "account"; accountId: string; epoch: string }));
    const originalSet = storage.set;
    storage.set = async (key, value) => {
      if (key === "widgetAccountScopeV1") throw new Error("scope set failed");
      await originalSet(key, value);
    };
    await expect(store.activateAccount("user-two")).rejects.toThrow("could not be verified");
    expect(await store.readSnapshot()).toBeNull();
  });

  test("guest activation clears personal content but permits a non-personal snapshot", async () => {
    const storage = memoryStorage();
    const store = createWidgetSnapshotStore(storage, () => "epoch-one");
    const account = await store.activateAccount("user-one");
    await store.write(snapshot(account as { kind: "account"; accountId: string; epoch: string }));
    await store.activateGuest();
    expect(await store.readSnapshot()).toBeNull();
    expect(await store.write(snapshot({ kind: "guest" }))).toBe(true);
    expect((await store.readSnapshot())?.scope).toEqual({ kind: "guest" });
  });

  test("guest activation clears an orphaned personal snapshot even when its scope is missing", async () => {
    const storage = memoryStorage();
    const accountStore = createWidgetSnapshotStore(storage, () => "epoch-one");
    const account = await accountStore.activateAccount("user-one");
    await accountStore.write(
      snapshot(account as { kind: "account"; accountId: string; epoch: string }),
    );
    storage.values.delete("widgetAccountScopeV1");

    const guestStore = createWidgetSnapshotStore(storage, () => "unused");
    await guestStore.activateGuest();
    expect(await guestStore.readSnapshot()).toBeNull();
  });

  test("guest activation leaves a failed personal removal scope-mismatched", async () => {
    const storage = memoryStorage();
    const store = createWidgetSnapshotStore(storage, () => "epoch-one");
    const account = await store.activateAccount("user-one");
    await store.write(snapshot(account as { kind: "account"; accountId: string; epoch: string }));
    const originalRemove = storage.remove;
    storage.remove = async (key) => {
      if (key === "discoverySnapshotV1") throw new Error("remove failed");
      await originalRemove(key);
    };
    expect(await store.activateGuest()).toEqual({ kind: "guest" });
    expect(await store.readScope()).toBeNull();
    expect((await store.readSnapshot())?.scope).toEqual(account);
  });

  test("clear removes both scope and snapshot and reloads WidgetKit", async () => {
    const storage = memoryStorage();
    const store = createWidgetSnapshotStore(storage, () => "epoch-one");
    const account = await store.activateAccount("user-one");
    await store.write(snapshot(account as { kind: "account"; accountId: string; epoch: string }));
    await store.clear();
    expect(await store.readScope()).toBeNull();
    expect(await store.readSnapshot()).toBeNull();
    expect(storage.reloads).toBeGreaterThanOrEqual(3);
  });

  test("clear treats a nullish native-stub read as empty", async () => {
    const store = createWidgetSnapshotStore(
      {
        get: async () => undefined,
        set: async () => {},
        remove: async () => {},
        reload: async () => {},
      },
      () => "epoch-one",
    );
    await expect(store.clear()).resolves.toBeUndefined();
  });

  test("a failed native write preserves the prior last-good snapshot", async () => {
    const storage = memoryStorage();
    const store = createWidgetSnapshotStore(storage, () => "epoch-one");
    const account = await store.activateAccount("user-one");
    const first = snapshot(account as { kind: "account"; accountId: string; epoch: string });
    expect(await store.write(first)).toBe(true);

    const originalSet = storage.set;
    storage.set = async (key, value) => {
      if (key === "discoverySnapshotV1") throw new Error("native write unavailable");
      await originalSet(key, value);
    };
    const replacement = { ...first, snapshotId: "replacement" };
    await expect(store.write(replacement)).rejects.toThrow("native write unavailable");
    expect(await store.readSnapshot()).toEqual(first);
  });

  test("a corrupt read-back restores the prior last-good snapshot", async () => {
    const storage = memoryStorage();
    const store = createWidgetSnapshotStore(storage, () => "epoch-one");
    const account = await store.activateAccount("user-one");
    const first = snapshot(account as { kind: "account"; accountId: string; epoch: string });
    await store.write(first);
    const originalSet = storage.set;
    let corruptNext = true;
    storage.set = async (key, value) => {
      if (key === "discoverySnapshotV1" && corruptNext) {
        corruptNext = false;
        storage.values.set(key, "{truncated");
        return;
      }
      await originalSet(key, value);
    };
    await expect(store.write({ ...first, snapshotId: "replacement" })).rejects.toThrow(
      "could not be verified",
    );
    expect(await store.readSnapshot()).toEqual(first);
  });

  test("compare-and-swap rejects personalization of an older snapshot", async () => {
    const storage = memoryStorage();
    const store = createWidgetSnapshotStore(storage, () => "epoch-one");
    const account = await store.activateAccount("user-one");
    const first = snapshot(account as { kind: "account"; accountId: string; epoch: string });
    await store.write(first);
    const newer = { ...first, snapshotId: "newer" };
    await store.write(newer);
    expect(
      await store.write(
        { ...first, snapshotId: "stale-personalization" },
        { expectedSnapshotId: first.snapshotId },
      ),
    ).toBe(false);
    expect(await store.readSnapshot()).toEqual(newer);
  });

  test("invalidation during a write removes the late personal snapshot", async () => {
    const storage = memoryStorage();
    const store = createWidgetSnapshotStore(storage, () => "epoch-one");
    const account = await store.activateAccount("user-one");
    let canWrite = true;
    const originalSet = storage.set;
    storage.set = async (key, value) => {
      await originalSet(key, value);
      if (key === "discoverySnapshotV1") canWrite = false;
    };
    expect(
      await store.write(
        snapshot(account as { kind: "account"; accountId: string; epoch: string }),
        { canWrite: () => canWrite },
      ),
    ).toBe(false);
    expect(await store.readSnapshot()).toBeNull();
  });
});

describe("widget snapshot session gate", () => {
  test("rejects late work from a signed-out or older session generation", () => {
    const gate = new WidgetSnapshotSessionGate();
    expect(gate.activate({ accountId: "user-one", authGeneration: 4 })).toBe(true);
    gate.invalidate();
    expect(gate.activate({ accountId: "user-one", authGeneration: 4 })).toBe(false);
    expect(gate.activate({ accountId: null, authGeneration: 5 })).toBe(true);
    expect(gate.activate({ accountId: "user-one", authGeneration: 4 })).toBe(false);
    expect(gate.activate({ accountId: "user-two", authGeneration: 5 })).toBe(false);
    expect(gate.matches({ accountId: null, authGeneration: 5 })).toBe(true);
  });

  test("allows a same-generation guest after boot cleanup but blocks the old account", () => {
    const gate = new WidgetSnapshotSessionGate();
    expect(gate.activate({ accountId: "user-one", authGeneration: 0 })).toBe(true);
    gate.invalidate();
    expect(gate.activate({ accountId: "user-one", authGeneration: 0 })).toBe(false);
    expect(gate.activate({ accountId: null, authGeneration: 0 })).toBe(true);
  });

  test("allows the trusted scope bridge to reactivate after an effect remount", () => {
    const gate = new WidgetSnapshotSessionGate();
    const session = { accountId: "user-one", authGeneration: 2 };
    expect(gate.activate(session)).toBe(true);
    gate.invalidate();
    expect(gate.request(session)).toBe(false);
    expect(gate.request(session, true)).toBe(true);
    expect(gate.commit(session)).toBe(true);
  });

  test("commits only the latest requested session", () => {
    const gate = new WidgetSnapshotSessionGate();
    const first = { accountId: "user-one", authGeneration: 1 };
    const second = { accountId: "user-two", authGeneration: 2 };
    expect(gate.request(first)).toBe(true);
    expect(gate.request(second)).toBe(true);
    expect(gate.commit(first)).toBe(false);
    expect(gate.commit(second)).toBe(true);
  });
});
