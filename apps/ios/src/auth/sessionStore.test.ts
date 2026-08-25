import { describe, expect, test } from "bun:test";
import type { StoredSession } from "./sessionController";
import { createSessionStore } from "./sessionStore";

const stored: StoredSession = {
  session: {
    token: "token-b",
    userId: "account-b",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
  user: {
    id: "account-b",
    email: "account-b@mapvest.dev",
    createdAt: "2026-01-01T00:00:00.000Z",
    scopes: ["user"],
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("session SecureStore adapter", () => {
  test("a timed-out late write deletes itself after controller cleanup", async () => {
    let raw: string | null = null;
    const pending = deferred<void>();
    const store = createSessionStore(
      {
        getItem: async () => raw,
        setItem: async (next) => {
          await pending.promise;
          raw = next;
        },
        deleteItem: async () => {
          raw = null;
        },
      },
      5,
    );

    await expect(store.write(stored)).rejects.toThrow("sign-in");
    await store.remove();
    pending.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(raw).toBeNull();
  });

  test("successful write is not deleted by its own completion microtask", async () => {
    let raw: string | null = null;
    const store = createSessionStore(
      {
        getItem: async () => raw,
        setItem: async (next) => {
          raw = next;
        },
        deleteItem: async () => {
          raw = null;
        },
      },
      50,
    );

    await store.write(stored);
    expect(raw as string | null).toBe(JSON.stringify(stored));
  });
});
