import { beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";
process.env.ADMIN_EMAILS = "admin@mapvest.dev";
// No POSTGRES_URL — every assertion below exercises the in-memory fallback
// path (dbEnabled() === false), matching local dev / CI without Postgres.
process.env.POSTGRES_URL = undefined;

import type { User } from "@mapvest/core";
import { app } from "../src/index.js";
import { dbEnabled } from "../src/lib/db.js";
import {
  FREE_GENERATION_LIMIT,
  __resetEntitlements,
  ensureUserEntitlements,
  getEntitlementState,
  isEmailFreeForever,
  recordGeneration,
  setFreeForever,
} from "../src/lib/entitlements.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import { __resetStore } from "../src/lib/store.js";
import { __resetIdentifyGuards } from "../src/middleware/identifyGuards.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";

function url(path: string) {
  return `http://localhost/v1${path}`;
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: overrides.id ?? `usr_${crypto.randomUUID().replace(/-/g, "")}`,
    email: overrides.email ?? "someone@example.com",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    scopes: overrides.scopes ?? ["user"],
  };
}

beforeEach(() => {
  __resetStore();
  __resetMetrics();
  __resetRateLimit();
  __resetIdentifyGuards();
  __resetEntitlements();
});

describe("entitlements (in-memory fallback)", () => {
  test("dbEnabled() is false in this test env — asserts we're exercising the memory path", () => {
    expect(dbEnabled()).toBe(false);
  });

  test("isEmailFreeForever matches 'jawaun' case-insensitively anywhere in the address", () => {
    expect(isEmailFreeForever("jawaun@mapvest.dev")).toBe(true);
    expect(isEmailFreeForever("JAWAUN@mapvest.dev")).toBe(true);
    expect(isEmailFreeForever("hello.jawaun.tb@gmail.com")).toBe(true);
    expect(isEmailFreeForever("someone-else@mapvest.dev")).toBe(false);
  });

  test("anonymous device gets a full 50-generation quota by default", async () => {
    const state = await getEntitlementState({ deviceId: "device-a" });
    expect(state.limit).toBe(FREE_GENERATION_LIMIT);
    expect(state.remaining).toBe(FREE_GENERATION_LIMIT);
    expect(state.freeForever).toBe(false);
    expect(state.subscribed).toBe(false);
    expect(state.canGenerate).toBe(true);
    expect(state.canPersist).toBe(false); // no userId → can't persist
  });

  test("recordGeneration decrements remaining for that device only", async () => {
    await recordGeneration({ deviceId: "device-b", kind: "identify" });
    await recordGeneration({ deviceId: "device-b", kind: "memo" });

    const b = await getEntitlementState({ deviceId: "device-b" });
    expect(b.remaining).toBe(FREE_GENERATION_LIMIT - 2);

    const other = await getEntitlementState({ deviceId: "device-c" });
    expect(other.remaining).toBe(FREE_GENERATION_LIMIT);
  });

  test("blocks generation once the free-tier limit is exhausted (51st over the cap)", async () => {
    for (let i = 0; i < FREE_GENERATION_LIMIT; i++) {
      await recordGeneration({ deviceId: "device-quota", kind: "identify" });
    }
    const state = await getEntitlementState({ deviceId: "device-quota" });
    expect(state.remaining).toBe(0);
    expect(state.canGenerate).toBe(false);
  });

  test("ensureUserEntitlements auto-grants free_forever for a jawaun email", async () => {
    const user = makeUser({ email: "jawaun@mapvest.dev" });
    await ensureUserEntitlements(user);

    // Exhaust what would otherwise be the cap — free_forever must ignore it.
    for (let i = 0; i < FREE_GENERATION_LIMIT + 10; i++) {
      await recordGeneration({ userId: user.id, kind: "identify" });
    }
    const state = await getEntitlementState({ userId: user.id, email: user.email });
    expect(state.freeForever).toBe(true);
    expect(state.plan).toBe("free_forever");
    expect(state.canGenerate).toBe(true);
    expect(state.remaining).toBe(FREE_GENERATION_LIMIT);
  });

  test("ensureUserEntitlements auto-grants free_forever for admin-scoped users", async () => {
    const admin = makeUser({ email: "boss@mapvest.dev", scopes: ["user", "admin"] });
    await ensureUserEntitlements(admin);
    const state = await getEntitlementState({ userId: admin.id });
    expect(state.freeForever).toBe(true);
  });

  test("a plain user without an account is capped at the free-tier limit", async () => {
    const user = makeUser({ email: "capped@example.com" });
    await ensureUserEntitlements(user); // no-op: not jawaun, not admin
    for (let i = 0; i < FREE_GENERATION_LIMIT; i++) {
      await recordGeneration({ userId: user.id, kind: "agent_chat" });
    }
    const state = await getEntitlementState({ userId: user.id, email: user.email });
    expect(state.freeForever).toBe(false);
    expect(state.canGenerate).toBe(false);
    expect(state.remaining).toBe(0);
  });

  test("setFreeForever lets an admin manually free (and later revoke) a user regardless of usage", async () => {
    const user = makeUser({ email: "vip@example.com" });
    for (let i = 0; i < FREE_GENERATION_LIMIT; i++) {
      await recordGeneration({ userId: user.id, kind: "memo" });
    }
    expect((await getEntitlementState({ userId: user.id })).canGenerate).toBe(false);

    await setFreeForever(user.id, true, "manual admin grant");
    const freed = await getEntitlementState({ userId: user.id });
    expect(freed.freeForever).toBe(true);
    expect(freed.plan).toBe("free_forever");
    expect(freed.canGenerate).toBe(true);

    await setFreeForever(user.id, false);
    const revoked = await getEntitlementState({ userId: user.id });
    expect(revoked.freeForever).toBe(false);
    expect(revoked.plan).toBe("none");
    // Usage was already recorded before the grant, so quota is exhausted again.
    expect(revoked.canGenerate).toBe(false);
  });

  test("canPersist requires a signed-in userId even for free_forever/subscribed states", async () => {
    const deviceOnly = await getEntitlementState({ deviceId: "device-anon" });
    expect(deviceOnly.canPersist).toBe(false);

    const user = makeUser({ email: "jawaun+persist@mapvest.dev" });
    await ensureUserEntitlements(user);
    const signedIn = await getEntitlementState({ userId: user.id, email: user.email });
    expect(signedIn.canPersist).toBe(true);
  });
});

describe("requireGenerationQuota + GET /v1/entitlements (HTTP)", () => {
  test("GET /v1/entitlements with only X-Device-Id reflects remaining quota", async () => {
    const res = await app.fetch(
      new Request(url("/entitlements"), { headers: { "X-Device-Id": "http-device-1" } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { remaining: number; limit: number; canGenerate: boolean };
    expect(body.limit).toBe(FREE_GENERATION_LIMIT);
    expect(body.remaining).toBe(FREE_GENERATION_LIMIT);
    expect(body.canGenerate).toBe(true);
  });

  test("requireGenerationQuota rejects anonymous requests with neither auth nor X-Device-Id", async () => {
    const { Hono } = await import("hono");
    const { requireGenerationQuota } = await import("../src/middleware/requireGenerationQuota.js");
    const testApp = new Hono();
    testApp.post("/gen", requireGenerationQuota("test_kind"), (c) => c.json({ ok: true }));

    const res = await testApp.fetch(new Request("http://localhost/gen", { method: "POST" }));
    expect(res.status).toBe(400);
  });

  test("requireGenerationQuota returns 402 quota_exceeded once a device's generations are spent", async () => {
    const { Hono } = await import("hono");
    const { requireGenerationQuota } = await import("../src/middleware/requireGenerationQuota.js");
    const testApp = new Hono();
    testApp.post("/gen", requireGenerationQuota("test_kind"), (c) => c.json({ ok: true }));

    const hit = () =>
      testApp.fetch(
        new Request("http://localhost/gen", {
          method: "POST",
          headers: { "X-Device-Id": "http-device-limit" },
        }),
      );

    for (let i = 0; i < FREE_GENERATION_LIMIT; i++) {
      const res = await hit();
      expect(res.status).toBe(200);
    }
    const blocked = await hit();
    expect(blocked.status).toBe(402);
    const body = (await blocked.json()) as { code: string; remaining: number; limit: number };
    expect(body.code).toBe("quota_exceeded");
    expect(body.remaining).toBe(0);
    expect(body.limit).toBe(FREE_GENERATION_LIMIT);
  });
});
