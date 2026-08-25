import { describe, expect, test } from "bun:test";
import type { Session, User } from "@/api/types";
import {
  SessionCleanupRequiredError,
  SessionController,
  type SessionControllerDeps,
  SessionPersistenceError,
  type SessionSnapshot,
  type StoredSession,
} from "./sessionController";

const user = (id: string): User => ({
  id,
  email: `${id}@mapvest.dev`,
  createdAt: "2026-01-01T00:00:00.000Z",
  scopes: ["user"],
});

const session = (token: string, userId: string): Session => ({
  token,
  userId,
  expiresAt: "2099-01-01T00:00:00.000Z",
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fixture(initial: StoredSession | null) {
  const calls: string[] = [];
  const snapshots: SessionSnapshot[] = [];
  let storedRaw = initial ? JSON.stringify(initial) : null;
  let deleteFailure = false;
  let writeFailure = false;
  const deps: SessionControllerDeps = {
    readStoredSession: async () => ({ raw: storedRaw, timedOut: false, readable: true }),
    getMe: async (_token, _signal) => ({ user: initial?.user ?? user("unknown") }),
    revokePush: async (old) => {
      calls.push(`revoke:${old?.token ?? "physical"}`);
    },
    cancelPush: async () => {
      calls.push("cancel-push");
    },
    writeStoredSession: async (next) => {
      calls.push(`write:${next.session.token}`);
      if (writeFailure) throw new SessionPersistenceError("write");
      storedRaw = JSON.stringify(next);
    },
    deleteStoredSession: async () => {
      calls.push("delete");
      if (deleteFailure) throw new SessionPersistenceError("delete");
      storedRaw = null;
    },
  };
  const controller = new SessionController(deps, (snapshot) => snapshots.push(snapshot));
  return {
    calls,
    snapshots,
    deps,
    controller,
    setDeleteFailure(value: boolean) {
      deleteFailure = value;
    },
    setWriteFailure(value: boolean) {
      writeFailure = value;
    },
    setStoredRaw(value: string | null) {
      storedRaw = value;
    },
  };
}

describe("SessionController async account lifecycle", () => {
  test("a delayed boot getMe cannot restore A after direct A to B sign-in", async () => {
    const a = { session: session("token-a", "account-a"), user: user("account-a") };
    const b = { session: session("token-b", "account-b"), user: user("account-b") };
    const f = fixture(a);
    const getMe = deferred<{ user: User }>();
    f.deps.getMe = async (_token, _signal) => getMe.promise;

    const boot = f.controller.startBoot();
    await Promise.resolve();
    expect(f.controller.getSnapshot().session?.token).toBe("token-a");

    const signIn = f.controller.signIn(b.session, b.user);
    const transitionGeneration = f.controller.getSnapshot().authGeneration;
    expect(f.controller.getSnapshot().phase).toBe("booting");
    expect(f.controller.isActiveSession(transitionGeneration, "token-a")).toBe(false);
    getMe.resolve({ user: a.user });
    await boot;
    await signIn;

    expect(f.controller.getSnapshot()).toMatchObject({
      phase: "authenticated",
      session: b.session,
      user: b.user,
      cleanupRequired: false,
    });
    expect(f.calls).toContain("revoke:token-a");
    expect(f.calls).not.toContain("revoke:token-b");
    expect(f.snapshots.at(-1)?.session?.token).toBe("token-b");
  });

  test("same-account token rotation cancels stale 401 work without revoking the account", async () => {
    const a = { session: session("token-a", "account-a"), user: user("account-a") };
    const rotated = { session: session("token-a-rotated", "account-a"), user: user("account-a") };
    const f = fixture(a);
    const getMe = deferred<{ user: User }>();
    f.deps.getMe = async (_token, _signal) => getMe.promise;

    const boot = f.controller.startBoot();
    await Promise.resolve();
    const signIn = f.controller.signIn(rotated.session, rotated.user);
    getMe.reject({ status: 401 });
    await boot;
    await signIn;

    expect(f.controller.getSnapshot().session?.token).toBe("token-a-rotated");
    expect(f.calls).toEqual(["cancel-push", "write:token-a-rotated"]);
  });

  test("native response guards require both the active session and transition generation", async () => {
    const a = { session: session("token-a", "account-a"), user: user("account-a") };
    const f = fixture(a);
    await f.controller.startBoot();
    const generationA = f.controller.getSnapshot().authGeneration;
    expect(f.controller.isActiveSession(generationA, "token-a")).toBe(true);

    const signOut = f.controller.signOut();
    const transitionGeneration = f.controller.getSnapshot().authGeneration;
    expect(transitionGeneration).not.toBe(generationA);
    expect(f.controller.getSnapshot().phase).toBe("booting");
    expect(f.controller.isActiveSession(transitionGeneration, "token-a")).toBe(false);
    expect(f.controller.isActiveSession(generationA, "token-a")).toBe(false);
    await signOut;
    expect(f.controller.isActiveSession(generationA, "token-a")).toBe(false);
  });

  test("cleanup-required boot state blocks B until revocation and storage cleanup succeed", async () => {
    const f = fixture(null);
    f.deps.readStoredSession = async () => ({ raw: null, timedOut: true, readable: false });
    let revokeFails = true;
    f.deps.revokePush = async () => {
      f.calls.push("revoke:physical");
      if (revokeFails) throw new Error("offline");
    };

    await f.controller.startBoot();
    expect(f.controller.getSnapshot()).toMatchObject({
      phase: "cleanup-required",
      ready: true,
      cleanupRequired: true,
    });
    await expect(
      f.controller.signIn(session("token-b", "account-b"), user("account-b")),
    ).rejects.toBeInstanceOf(SessionCleanupRequiredError);
    expect(f.controller.getSnapshot().session).toBeNull();

    revokeFails = false;
    await f.controller.signIn(session("token-b", "account-b"), user("account-b"));
    expect(f.controller.getSnapshot().session?.token).toBe("token-b");
  });

  test("parse failure and a boot-time 401 expose cleanup instead of guest state", async () => {
    const a = { session: session("token-a", "account-a"), user: user("account-a") };
    const f = fixture(a);
    f.setStoredRaw("not-json");
    let revokeFails = true;
    f.deps.revokePush = async () => {
      if (revokeFails) throw new Error("offline");
    };

    await f.controller.startBoot();
    expect(f.controller.getSnapshot().phase).toBe("cleanup-required");
    expect(f.controller.getSnapshot().phase).not.toBe("guest");

    revokeFails = false;
    await f.controller.retryCleanup();
    expect(f.controller.getSnapshot().phase).toBe("guest");

    const invalid = fixture(a);
    invalid.deps.getMe = async () => {
      throw { status: 401 };
    };
    invalid.deps.revokePush = async () => {
      throw new Error("offline");
    };
    await invalid.controller.startBoot();
    expect(invalid.controller.getSnapshot()).toMatchObject({
      phase: "cleanup-required",
      cleanupRequired: true,
      session: null,
    });

    const expired = {
      session: { ...session("token-expired", "account-a"), expiresAt: "2000-01-01T00:00:00.000Z" },
      user: a.user,
    };
    const expiredController = fixture(expired);
    expiredController.deps.revokePush = async () => {
      throw new Error("offline");
    };
    await expiredController.controller.startBoot();
    expect(expiredController.controller.getSnapshot().phase).toBe("cleanup-required");
  });

  test("a SecureStore write failure is not reported as successful sign-in", async () => {
    const f = fixture(null);
    f.setWriteFailure(true);

    await expect(
      f.controller.signIn(session("token-b", "account-b"), user("account-b")),
    ).rejects.toBeInstanceOf(SessionPersistenceError);
    expect(f.controller.getSnapshot()).toMatchObject({
      phase: "guest",
      session: null,
      cleanupRequired: false,
    });
    expect(f.calls).toEqual(["revoke:physical", "write:token-b", "delete"]);
  });

  test("a SecureStore delete failure keeps sign-out retryable instead of clearing auth", async () => {
    const a = { session: session("token-a", "account-a"), user: user("account-a") };
    const f = fixture(a);
    f.setDeleteFailure(true);
    await f.controller.startBoot();

    await expect(f.controller.signOut()).rejects.toBeInstanceOf(SessionPersistenceError);
    expect(f.controller.getSnapshot()).toMatchObject({
      phase: "cleanup-required",
      cleanupRequired: true,
      session: null,
    });

    f.setDeleteFailure(false);
    await f.controller.retryCleanup();
    expect(f.controller.getSnapshot().phase).toBe("guest");
  });
});
