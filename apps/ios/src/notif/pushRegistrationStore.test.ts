import { describe, expect, test } from "bun:test";
import { persistPushTokenId } from "./pushRegistrationStore";

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

  test("a late timed-out completion is deleted", async () => {
    let value: string | null = null;
    let deletes = 0;
    const pending = deferred<void>();
    const ok = await persistPushTokenId(
      {
        set: async (id) => {
          await pending.promise;
          value = id;
        },
        delete: async () => {
          deletes += 1;
          value = null;
        },
      },
      "claim-a",
      () => true,
      5,
    );

    expect(ok).toBe(false);
    pending.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(value).toBeNull();
    expect(deletes).toBe(1);
  });
});
