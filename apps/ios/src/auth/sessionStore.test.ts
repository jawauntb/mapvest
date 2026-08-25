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
  test("a timed-out write keeps cleanup blocked until its native mutation settles", async () => {
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
    await expect(store.remove()).rejects.toThrow("sign-out");
    pending.resolve();
    await store.remove();

    expect(raw).toBeNull();
  });

  test("a later B write cannot race an A timeout and late completion", async () => {
    let raw: string | null = null;
    const pending = deferred<void>();
    const accountA = {
      ...stored,
      session: { ...stored.session, token: "token-a", userId: "account-a" },
      user: { ...stored.user, id: "account-a", email: "account-a@mapvest.dev" },
    };
    const store = createSessionStore(
      {
        getItem: async () => raw,
        setItem: async (next) => {
          if (next === JSON.stringify(accountA)) await pending.promise;
          raw = next;
        },
        deleteItem: async () => {
          raw = null;
        },
      },
      5,
    );

    await expect(store.write(accountA)).rejects.toThrow("sign-in");
    // The controller cannot safely start B while A is still in native code.
    await expect(store.write(stored)).rejects.toThrow("sign-in");
    expect(raw).toBeNull();

    pending.resolve();
    await store.remove();
    await store.write(stored);
    expect(raw as string | null).toBe(JSON.stringify(stored));
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
