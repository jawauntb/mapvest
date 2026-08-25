import { beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { sign } from "hono/jwt";
import { app } from "../src/index.js";
import { deliverPush } from "../src/lib/push-dispatcher.js";
import {
  _resetPushTokenMemory,
  claimPushDelivery,
  finalizePushDelivery,
  listTokensForEvent,
  listTokensForUser,
  listTokensForUserAndEvent,
  pushNotificationsEnabled,
  registerPushToken,
  unregisterPushToken,
  unregisterPushTokenByIdentity,
  updatePrefs,
} from "../src/lib/push-tokens-store.js";
import { __resetStore, ensureUser } from "../src/lib/store.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";

beforeEach(() => {
  _resetPushTokenMemory();
  __resetStore();
  __resetRateLimit();
});

const userId = () => `u_push_${crypto.randomUUID()}`;
const expoToken = () => `ExponentPushToken[${crypto.randomUUID()}]`;

async function sessionFor(id: string, email: string): Promise<string> {
  await ensureUser(id, email);
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      purpose: "session",
      sub: id,
      email,
      iat: now,
      exp: now + 60 * 60,
    },
    process.env.SESSION_SIGNING_KEY!,
  );
}

describe("push product-level mute", () => {
  test("legacy tokens without the master field remain enabled", () => {
    expect(pushNotificationsEnabled({ prefs: { daily_brief: true } })).toBe(true);
  });

  test("new tokens start muted and event delivery requires the master switch", async () => {
    const uid = userId();
    const token = await registerPushToken(uid, expoToken(), "ios", "phone");

    expect(token.prefs.notifications_enabled).toBe(false);
    await updatePrefs(uid, token.id, { daily_brief: true });
    expect(await listTokensForEvent("daily_brief")).toEqual([]);

    await updatePrefs(uid, token.id, { notifications_enabled: true });
    expect((await listTokensForUserAndEvent(uid, "daily_brief")).map((t) => t.id)).toEqual([
      token.id,
    ]);

    await updatePrefs(uid, token.id, { notifications_enabled: false });
    expect(await listTokensForUserAndEvent(uid, "daily_brief")).toEqual([]);
  });

  test("master mute is per device and does not cross-write another device", async () => {
    const uid = userId();
    const phone = await registerPushToken(uid, expoToken(), "ios", "phone");
    const tablet = await registerPushToken(uid, expoToken(), "ios", "tablet");
    await updatePrefs(uid, phone.id, { notifications_enabled: true, daily_brief: true });
    await updatePrefs(uid, tablet.id, { notifications_enabled: false, daily_brief: true });

    const eligible = await listTokensForUserAndEvent(uid, "daily_brief");
    expect(eligible.map((t) => t.id)).toEqual([phone.id]);
    expect((await listTokensForEvent("daily_brief")).map((t) => t.id)).toEqual([phone.id]);
  });
});

describe("push token account isolation", () => {
  test("reassigning one Expo token resets consent and removes the prior owner's delivery path", async () => {
    const priorUser = userId();
    const nextUser = userId();
    const physicalToken = expoToken();
    const prior = await registerPushToken(priorUser, physicalToken, "ios", "phone");
    await updatePrefs(priorUser, prior.id, { notifications_enabled: true, daily_brief: true });
    expect((await listTokensForEvent("daily_brief")).map((token) => token.userId)).toEqual([
      priorUser,
    ]);

    const reassigned = await registerPushToken(nextUser, physicalToken, "ios", "phone");
    expect(reassigned.userId).toBe(nextUser);
    expect(reassigned.prefs).toMatchObject({ notifications_enabled: false, daily_brief: false });
    expect(await listTokensForUser(priorUser)).toEqual([]);
    expect(await listTokensForEvent("daily_brief")).toEqual([]);
    expect(await updatePrefs(priorUser, prior.id, { daily_brief: true })).toBeNull();

    await updatePrefs(nextUser, reassigned.id, { notifications_enabled: true, daily_brief: true });
    expect((await listTokensForEvent("daily_brief")).map((token) => token.userId)).toEqual([
      nextUser,
    ]);
  });

  test("unregistering one installation leaves another installation for the same account active", async () => {
    const uid = userId();
    const phone = await registerPushToken(uid, expoToken(), "ios", "phone");
    const tablet = await registerPushToken(uid, expoToken(), "ios", "tablet");
    await updatePrefs(uid, phone.id, { notifications_enabled: true, daily_brief: true });
    await updatePrefs(uid, tablet.id, { notifications_enabled: true, daily_brief: true });

    expect(await unregisterPushToken(uid, phone.id)).toBe(true);
    expect((await listTokensForUserAndEvent(uid, "daily_brief")).map((token) => token.id)).toEqual([
      tablet.id,
    ]);
  });

  test("revocation-only identity route works without a bearer session", async () => {
    const uid = userId();
    const physicalToken = expoToken();
    const token = await registerPushToken(uid, physicalToken, "ios", "phone");
    await updatePrefs(uid, token.id, { notifications_enabled: true, daily_brief: true });

    const response = await app.fetch(
      new Request("http://localhost/v1/push/revoke-device", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: physicalToken, deviceId: "phone" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revoked: true, matched: true });
    expect(await listTokensForUser(uid)).toEqual([]);
    expect(await unregisterPushTokenByIdentity(physicalToken, "phone")).toBe(false);
  });
});

describe("claim-validated push delivery", () => {
  test("serializes concurrent claims for one token and dedupe key", async () => {
    const uid = userId();
    const token = await registerPushToken(uid, expoToken(), "ios", "phone");
    await updatePrefs(uid, token.id, { notifications_enabled: true, daily_brief: true });

    const [first, second] = await Promise.all([
      claimPushDelivery([token], [{ slot: "daily_brief", key: "20260825" }], "daily_brief"),
      claimPushDelivery([token], [{ slot: "daily_brief", key: "20260825" }], "daily_brief"),
    ]);
    expect(first.length + second.length).toBe(1);
    const winner = first[0] ?? second[0]!;
    await finalizePushDelivery(winner ? [winner] : [], new Set([token.expoToken]));
    expect((await listTokensForUser(uid))[0]?.prefs.last_sent?.daily_brief).toBe("20260825");
  });

  test("concurrent notifier deliveries hand off to Expo once", async () => {
    const uid = userId();
    const token = await registerPushToken(uid, expoToken(), "ios", "phone");
    await updatePrefs(uid, token.id, { notifications_enabled: true, daily_brief: true });
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ data: [{ status: "ok", id: "ticket" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const candidates = await listTokensForEvent("daily_brief");
      const [first, second] = await Promise.all([
        deliverPush({
          tokens: candidates,
          dedupe: [{ slot: "daily_brief", key: "20260825" }],
          eventKey: "daily_brief",
          title: "Morning read",
          body: "Ready",
        }),
        deliverPush({
          tokens: candidates,
          dedupe: [{ slot: "daily_brief", key: "20260825" }],
          eventKey: "daily_brief",
          title: "Morning read",
          body: "Ready",
        }),
      ]);
      expect(calls).toBe(1);
      expect(first.successes + second.successes).toBe(1);
      expect((await listTokensForUser(uid))[0]?.prefs.last_sent?.daily_brief).toBe("20260825");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("invalid Expo tickets revoke the still-owned token", async () => {
    const uid = userId();
    const token = await registerPushToken(uid, expoToken(), "ios", "phone");
    await updatePrefs(uid, token.id, { notifications_enabled: true, daily_brief: true });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              status: "error",
              message: "Device is not registered",
              details: { error: "DeviceNotRegistered" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      const result = await deliverPush({
        tokens: [token],
        dedupe: [{ slot: "daily_brief", key: "20260825" }],
        eventKey: "daily_brief",
        title: "Morning read",
        body: "Ready",
      });
      expect(result.invalidTokens).toEqual([token.expoToken]);
      expect(await listTokensForUser(uid)).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("push prefs route", () => {
  test("registration under a second account cannot deliver or edit the first account's token", async () => {
    const firstId = userId();
    const secondId = userId();
    const firstBearer = await sessionFor(firstId, `${firstId}@mapvest.dev`);
    const secondBearer = await sessionFor(secondId, `${secondId}@mapvest.dev`);
    const physicalToken = expoToken();

    const firstRegister = await app.fetch(
      new Request("http://localhost/v1/push/register", {
        method: "POST",
        headers: { Authorization: `Bearer ${firstBearer}`, "content-type": "application/json" },
        body: JSON.stringify({ token: physicalToken, platform: "ios", deviceId: "phone" }),
      }),
    );
    const first = (await firstRegister.json()) as { id: string };
    const firstEnable = await app.fetch(
      new Request("http://localhost/v1/push/prefs", {
        method: "POST",
        headers: { Authorization: `Bearer ${firstBearer}`, "content-type": "application/json" },
        body: JSON.stringify({
          tokenId: first.id,
          prefs: { notifications_enabled: true, daily_brief: true },
        }),
      }),
    );
    expect(firstEnable.status).toBe(200);

    const secondRegister = await app.fetch(
      new Request("http://localhost/v1/push/register", {
        method: "POST",
        headers: { Authorization: `Bearer ${secondBearer}`, "content-type": "application/json" },
        body: JSON.stringify({ token: physicalToken, platform: "ios", deviceId: "phone" }),
      }),
    );
    expect(secondRegister.status).toBe(200);
    const second = (await secondRegister.json()) as {
      id: string;
      prefs: { notifications_enabled?: boolean };
    };
    expect(second.prefs).toMatchObject({ notifications_enabled: false, daily_brief: false });

    const staleWrite = await app.fetch(
      new Request("http://localhost/v1/push/prefs", {
        method: "POST",
        headers: { Authorization: `Bearer ${firstBearer}`, "content-type": "application/json" },
        body: JSON.stringify({ tokenId: first.id, prefs: { daily_brief: true } }),
      }),
    );
    expect(staleWrite.status).toBe(404);
    expect(await listTokensForUser(firstId)).toEqual([]);
    expect(await listTokensForEvent("daily_brief")).toEqual([]);
  });

  test("persists and reads the master switch for the requested device", async () => {
    const uid = userId();
    const email = `${uid}@mapvest.dev`;
    const bearer = await sessionFor(uid, email);
    const register = await app.fetch(
      new Request("http://localhost/v1/push/register", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: expoToken(), platform: "ios", deviceId: "phone" }),
      }),
    );
    expect(register.status).toBe(200);
    const registered = (await register.json()) as {
      id: string;
      prefs: { notifications_enabled?: boolean };
    };
    expect(registered.prefs.notifications_enabled).toBe(false);

    const write = await app.fetch(
      new Request("http://localhost/v1/push/prefs", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tokenId: registered.id,
          prefs: { notifications_enabled: true, daily_brief: true },
        }),
      }),
    );
    expect(write.status).toBe(200);

    const read = await app.fetch(
      new Request(`http://localhost/v1/push/prefs?tokenId=${registered.id}`, {
        headers: { Authorization: `Bearer ${bearer}` },
      }),
    );
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      tokenId: registered.id,
      prefs: { notifications_enabled: true, daily_brief: true },
    });

    const tablet = await registerPushToken(uid, expoToken(), "ios", "tablet");
    const tabletRead = await app.fetch(
      new Request(`http://localhost/v1/push/prefs?tokenId=${tablet.id}`, {
        headers: { Authorization: `Bearer ${bearer}` },
      }),
    );
    expect(tabletRead.status).toBe(200);
    expect(await tabletRead.json()).toMatchObject({
      tokenId: tablet.id,
      prefs: { notifications_enabled: false },
    });

    const staleRead = await app.fetch(
      new Request("http://localhost/v1/push/prefs?tokenId=push_stale", {
        headers: { Authorization: `Bearer ${bearer}` },
      }),
    );
    expect(staleRead.status).toBe(200);
    expect(await staleRead.json()).toEqual({ prefs: {}, tokenId: null });

    const fallbackRead = await app.fetch(
      new Request("http://localhost/v1/push/prefs", {
        headers: { Authorization: `Bearer ${bearer}` },
      }),
    );
    expect(fallbackRead.status).toBe(200);
    expect(await fallbackRead.json()).toMatchObject({ tokenId: tablet.id });
  });
});
