import { describe, expect, test } from "bun:test";
import { deletePersistedPushTokenId, persistPushTokenId } from "./pushRegistrationStore";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("push claimant id persistence", () => {
  test("normal completion is not deleted by its own completion microtask", async () => {
    let value: string | null = null;
    let deletes = 0;
    const ok = await persistPushTokenId(
      {
        set: async (id) => {
          value = id;
        },
        delete: async () => {
          deletes += 1;
          value = null;
        },
      },
      "claim-a",
      () => true,
      50,
    );

    expect(ok).toBe(true);
    expect(value as string | null).toBe("claim-a");
    expect(deletes).toBe(0);
  });

  test("a timed-out completion blocks B until the native mutation settles", async () => {
    let value: string | null = null;
    let deletes = 0;
    const pending = deferred<void>();
    const storage = {
      set: async (id: string) => {
        await pending.promise;
        value = id;
      },
      delete: async () => {
        deletes += 1;
        value = null;
      },
    };
    const ok = await persistPushTokenId(storage, "claim-a", () => true, 5);

    expect(ok).toBe(false);
    const blocked = await persistPushTokenId(storage, "claim-b", () => true, 5);
    expect(blocked).toBe(false);
    expect(value).toBeNull();

    pending.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(value as string | null).toBe("claim-a");
    expect(await persistPushTokenId(storage, "claim-b", () => true, 50)).toBe(true);
    expect(value as string | null).toBe("claim-b");
    expect(deletes).toBe(0);
  });

  test("cleanup waits for a timed-out claimant write before deleting", async () => {
    let value: string | null = null;
    const pending = deferred<void>();
    const storage = {
      set: async (id: string) => {
        await pending.promise;
        value = id;
      },
      delete: async () => {
        value = null;
      },
    };
    await expect(persistPushTokenId(storage, "claim-a", () => true, 5)).resolves.toBe(false);
    await expect(deletePersistedPushTokenId(storage, 5)).rejects.toThrow("pending");
    pending.resolve();
    await deletePersistedPushTokenId(storage, 5);
    expect(value).toBeNull();
  });

  test("a marker timeout cannot erase B evidence during cleanup", async () => {
    let value: string | null = null;
    let deletes = 0;
    const pending = deferred<void>();
    const storage = {
      set: async (next: string) => {
        if (next === "1") await pending.promise;
        value = next;
      },
      delete: async () => {
        deletes += 1;
        value = null;
      },
    };

    await expect(persistPushTokenId(storage, "1", () => true, 5)).resolves.toBe(false);
    await expect(deletePersistedPushTokenId(storage, 5)).rejects.toThrow("pending");
    await expect(persistPushTokenId(storage, "1", () => true, 5)).resolves.toBe(false);

    pending.resolve();
    await deletePersistedPushTokenId(storage, 50);
    await expect(persistPushTokenId(storage, "1", () => true, 50)).resolves.toBe(true);
    expect(value as string | null).toBe("1");
    expect(deletes).toBe(1);
  });
});
