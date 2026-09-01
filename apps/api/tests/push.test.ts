import { beforeEach, describe, expect, test } from "bun:test";
import {
  PushNotificationTarget,
  PushPreferencesReadResponse,
  PushPreferencesUpdateResponse,
  PushRegistrationResponse,
} from "@mapvest/core";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { sign } from "hono/jwt";
import { app } from "../src/index.js";
import { onLocalBriefGenerated } from "../src/lib/notifiers/localBriefNotifier.js";
import { deliverPush } from "../src/lib/push-dispatcher.js";
import {
  _cleanupPushDeliveryHandoffForTest,
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

async function expiredSessionFor(id: string, email: string, expiredAgoSec = 1): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      purpose: "session",
      sub: id,
      email,
      iat: now - 30 * 24 * 60 * 60 - expiredAgoSec,
      exp: now - expiredAgoSec,
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

  test("revocation-only identity route works without a bearer session after device ID rotation", async () => {
    const uid = userId();
    const physicalToken = expoToken();
    const token = await registerPushToken(uid, physicalToken, "ios", "phone");
    await updatePrefs(uid, token.id, { notifications_enabled: true, daily_brief: true });

    const response = await app.fetch(
      new Request("http://localhost/v1/push/revoke-device", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: physicalToken,
          tokenId: token.id,
          deviceId: "reinstalled-phone",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true, matched: true, outcome: "revoked" });
    expect(await listTokensForUser(uid)).toEqual([]);
    const retry = await app.fetch(
      new Request("http://localhost/v1/push/revoke-device", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: physicalToken, tokenId: token.id, deviceId: "phone" }),
      }),
    );
    expect(await retry.json()).toEqual({
      revoked: true,
      matched: false,
      outcome: "already-revoked",
    });
    expect(await unregisterPushTokenByIdentity(physicalToken, token.id, "phone")).toBe(
      "already-revoked",
    );
  });

  test("a stale public token id cannot revoke a later owner, while an authenticated owner can recover after device ID rotation", async () => {
    const firstUser = userId();
    const secondUser = userId();
    const physicalToken = expoToken();
    const first = await registerPushToken(firstUser, physicalToken, "ios", "phone");
    const second = await registerPushToken(secondUser, physicalToken, "ios", "phone");

    const missingId = await app.fetch(
      new Request("http://localhost/v1/push/revoke-device", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: physicalToken, deviceId: "phone" }),
      }),
    );
    expect(missingId.status).toBe(400);

    const stale = await app.fetch(
      new Request("http://localhost/v1/push/revoke-device", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: physicalToken, tokenId: first.id, deviceId: "phone" }),
      }),
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      revoked: false,
      matched: false,
      outcome: "claim-mismatch",
    });
    expect((await listTokensForUser(secondUser)).map((token) => token.id)).toEqual([second.id]);

    const firstBearer = await sessionFor(firstUser, `${firstUser}@mapvest.dev`);
    const authenticatedMismatch = await app.fetch(
      new Request("http://localhost/v1/push/revoke-current-device", {
        method: "POST",
        headers: { Authorization: `Bearer ${firstBearer}`, "content-type": "application/json" },
        body: JSON.stringify({ token: physicalToken, deviceId: "phone" }),
      }),
    );
    expect(authenticatedMismatch.status).toBe(409);
    expect(await authenticatedMismatch.json()).toEqual({
      revoked: false,
      matched: false,
      outcome: "claim-mismatch",
    });

    const bearer = await sessionFor(secondUser, `${secondUser}@mapvest.dev`);
    const authenticated = await app.fetch(
      new Request("http://localhost/v1/push/revoke-current-device", {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({ token: physicalToken, deviceId: "reinstalled-phone" }),
      }),
    );
    expect(authenticated.status).toBe(200);
    expect(await authenticated.json()).toEqual({
      revoked: true,
      matched: true,
      outcome: "revoked",
    });
    expect(await listTokensForUser(secondUser)).toEqual([]);

    const authenticatedRetry = await app.fetch(
      new Request("http://localhost/v1/push/revoke-current-device", {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({ token: physicalToken, deviceId: "phone" }),
      }),
    );
    expect(await authenticatedRetry.json()).toEqual({
      revoked: true,
      matched: false,
      outcome: "already-revoked",
    });
  });

  test("a recently expired signed session can revoke only its own current claim", async () => {
    const owner = userId();
    const ownerEmail = `${owner}@mapvest.dev`;
    await ensureUser(owner, ownerEmail);
    const ownerToken = expoToken();
    const registered = await registerPushToken(owner, ownerToken, "ios", "phone");
    const expiredBearer = await expiredSessionFor(owner, ownerEmail);

    const protectedRoute = await app.fetch(
      new Request("http://localhost/v1/push/revoke-current-device", {
        method: "POST",
        headers: { Authorization: `Bearer ${expiredBearer}`, "content-type": "application/json" },
        body: JSON.stringify({ token: ownerToken, deviceId: "reinstalled-phone" }),
      }),
    );
    expect(protectedRoute.status).toBe(401);

    const recovered = await app.fetch(
      new Request("http://localhost/v1/push/revoke-expired-session-device", {
        method: "POST",
        headers: { Authorization: `Bearer ${expiredBearer}`, "content-type": "application/json" },
        // Permission denial can leave iOS with its opaque registration id but
        // no Expo token. The signed former session may revoke only this id.
        body: JSON.stringify({ tokenId: registered.id, deviceId: "reinstalled-phone" }),
      }),
    );
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ revoked: true, matched: true, outcome: "revoked" });
    expect(await listTokensForUser(owner)).toEqual([]);

    const retry = await app.fetch(
      new Request("http://localhost/v1/push/revoke-expired-session-device", {
        method: "POST",
        headers: { Authorization: `Bearer ${expiredBearer}`, "content-type": "application/json" },
        body: JSON.stringify({ tokenId: registered.id }),
      }),
    );
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({
      revoked: true,
      matched: false,
      outcome: "already-revoked",
    });

    const laterOwner = userId();
    const transferred = await registerPushToken(laterOwner, ownerToken, "ios", "phone");
    const staleExpired = await app.fetch(
      new Request("http://localhost/v1/push/revoke-expired-session-device", {
        method: "POST",
        headers: { Authorization: `Bearer ${expiredBearer}`, "content-type": "application/json" },
        body: JSON.stringify({ tokenId: registered.id, deviceId: "reinstalled-phone" }),
      }),
    );
    expect(staleExpired.status).toBe(409);
    expect(await staleExpired.json()).toEqual({
      revoked: false,
      matched: false,
      outcome: "claim-mismatch",
    });
    expect((await listTokensForUser(laterOwner)).map((token) => token.id)).toEqual([
      transferred.id,
    ]);
    expect(registered.id).not.toBe(transferred.id);
  });

  test("an older signed session needs an opaque id and remains mismatch-safe", async () => {
    const uid = userId();
    const physicalToken = expoToken();
    const registered = await registerPushToken(uid, physicalToken, "ios", "phone");
    const tooOld = await expiredSessionFor(uid, `${uid}@mapvest.dev`, 90 * 24 * 60 * 60 + 1);

    const expoOnly = await app.fetch(
      new Request("http://localhost/v1/push/revoke-expired-session-device", {
        method: "POST",
        headers: { Authorization: `Bearer ${tooOld}`, "content-type": "application/json" },
        body: JSON.stringify({ token: physicalToken }),
      }),
    );
    expect(expoOnly.status).toBe(401);
    expect((await listTokensForUser(uid)).map((token) => token.expoToken)).toEqual([physicalToken]);

    const tokenIdRecovery = await app.fetch(
      new Request("http://localhost/v1/push/revoke-expired-session-device", {
        method: "POST",
        headers: { Authorization: `Bearer ${tooOld}`, "content-type": "application/json" },
        body: JSON.stringify({ tokenId: registered.id }),
      }),
    );
    expect(tokenIdRecovery.status).toBe(200);
    expect(await tokenIdRecovery.json()).toEqual({
      revoked: true,
      matched: true,
      outcome: "revoked",
    });

    const tokenIdRetry = await app.fetch(
      new Request("http://localhost/v1/push/revoke-expired-session-device", {
        method: "POST",
        headers: { Authorization: `Bearer ${tooOld}`, "content-type": "application/json" },
        body: JSON.stringify({ tokenId: registered.id }),
      }),
    );
    expect(tokenIdRetry.status).toBe(200);
    expect(await tokenIdRetry.json()).toEqual({
      revoked: true,
      matched: false,
      outcome: "already-revoked",
    });

    const transferredExpoToken = expoToken();
    const former = await registerPushToken(uid, transferredExpoToken, "ios", "phone");
    const laterOwner = userId();
    const current = await registerPushToken(laterOwner, transferredExpoToken, "ios", "phone");
    const staleTokenId = await app.fetch(
      new Request("http://localhost/v1/push/revoke-expired-session-device", {
        method: "POST",
        headers: { Authorization: `Bearer ${tooOld}`, "content-type": "application/json" },
        body: JSON.stringify({ tokenId: former.id }),
      }),
    );
    expect(staleTokenId.status).toBe(409);
    expect(await staleTokenId.json()).toEqual({
      revoked: false,
      matched: false,
      outcome: "claim-mismatch",
    });
    expect((await listTokensForUser(laterOwner)).map((token) => token.id)).toEqual([current.id]);
  });
});

describe("push route contract", () => {
  test("documents and validates registration, preferences, and token deletion", async () => {
    const uid = userId();
    const bearer = await sessionFor(uid, `${uid}@mapvest.dev`);
    const physicalToken = expoToken();

    const invalidRegistration = await app.fetch(
      new Request("http://localhost/v1/push/register", {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({ token: physicalToken, platform: "web" }),
      }),
    );
    expect(invalidRegistration.status).toBe(400);

    const registration = await app.fetch(
      new Request("http://localhost/v1/push/register", {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({ token: physicalToken, platform: "android", deviceId: "phone" }),
      }),
    );
    expect(registration.status).toBe(200);
    const registered = PushRegistrationResponse.parse(await registration.json());
    expect(registered.prefs.notifications_enabled).toBe(false);

    const invalidPatch = await app.fetch(
      new Request("http://localhost/v1/push/prefs", {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({ tokenId: registered.id, prefs: { daily_brief: "yes" } }),
      }),
    );
    expect(invalidPatch.status).toBe(400);

    const updated = await app.fetch(
      new Request("http://localhost/v1/push/prefs", {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({
          tokenId: registered.id,
          prefs: { notifications_enabled: true, daily_brief: true, future_opt_in: true },
        }),
      }),
    );
    expect(updated.status).toBe(200);
    expect(PushPreferencesUpdateResponse.parse(await updated.json()).prefs).toMatchObject({
      notifications_enabled: true,
      daily_brief: true,
    });

    const read = await app.fetch(
      new Request(`http://localhost/v1/push/prefs?tokenId=${encodeURIComponent(registered.id)}`, {
        headers: { Authorization: `Bearer ${bearer}` },
      }),
    );
    expect(read.status).toBe(200);
    expect(PushPreferencesReadResponse.parse(await read.json()).tokenId).toBe(registered.id);

    const invalidQuery = await app.fetch(
      new Request("http://localhost/v1/push/prefs?tokenId=%20", {
        headers: { Authorization: `Bearer ${bearer}` },
      }),
    );
    expect(invalidQuery.status).toBe(400);

    const removed = await app.fetch(
      new Request(`http://localhost/v1/push/token/${encodeURIComponent(registered.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${bearer}` },
      }),
    );
    expect(removed.status).toBe(204);

    const missing = await app.fetch(
      new Request(`http://localhost/v1/push/token/${encodeURIComponent(registered.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${bearer}` },
      }),
    );
    expect(missing.status).toBe(404);
  });
});

describe("claim-validated push delivery", () => {
  test("rejects incomplete map destinations at the shared schema boundary", () => {
    expect(PushNotificationTarget.safeParse({ type: "map", lat: 40 }).success).toBe(false);
    expect(PushNotificationTarget.safeParse({ type: "map" }).success).toBe(false);
    expect(PushNotificationTarget.safeParse({ type: "map", placeId: "place-one" }).success).toBe(
      true,
    );
  });

  test("handoff cleanup unlocks every token before pool release and preserves a release-only result", async () => {
    const individualUnlockFailure = new Error("one per-token unlock failed");
    const releaseFailure = new Error("pool release failed");
    const order: string[] = [];
    const cleanup = await _cleanupPushDeliveryHandoffForTest(["first", "second"], {
      unlock: async (expoToken) => {
        order.push(`unlock:${expoToken}`);
        if (expoToken === "second") throw individualUnlockFailure;
      },
      unlockAll: async () => {
        order.push("unlock-all");
      },
      release: async () => {
        order.push("release");
        throw releaseFailure;
      },
    });

    expect(order).toEqual(["unlock:second", "unlock:first", "unlock-all", "release"]);
    expect(cleanup.unlockAllSucceeded).toBe(true);
    expect(cleanup.unlockError).toBe(individualUnlockFailure);
    expect(cleanup.releaseError).toBe(releaseFailure);
  });

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
          target: { type: "home", section: "daily-brief" },
        }),
        deliverPush({
          tokens: candidates,
          dedupe: [{ slot: "daily_brief", key: "20260825" }],
          eventKey: "daily_brief",
          title: "Morning read",
          body: "Ready",
          target: { type: "home", section: "daily-brief" },
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
        target: { type: "home", section: "daily-brief" },
      });
      expect(result.invalidTokens).toEqual([token.expoToken]);
      expect(await listTokensForUser(uid)).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("app credential errors never revoke a user's valid installation", async () => {
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
              message: "Push credentials are invalid",
              details: { error: "InvalidCredentials" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      const result = await deliverPush({
        tokens: [token],
        dedupe: [{ slot: "daily_brief", key: "20260826" }],
        eventKey: "daily_brief",
        title: "Morning read",
        body: "Ready",
        target: { type: "home", section: "daily-brief" },
      });
      expect(result.failures).toBe(1);
      expect(result.invalidTokens).toEqual([]);
      expect((await listTokensForUser(uid)).map((candidate) => candidate.id)).toEqual([token.id]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("sends a unique scoped envelope per installation while preserving legacy data", async () => {
    const uid = userId();
    const phone = await registerPushToken(uid, expoToken(), "ios", "phone");
    const tablet = await registerPushToken(uid, expoToken(), "ios", "tablet");
    await updatePrefs(uid, phone.id, { notifications_enabled: true, uncaught_nearby: true });
    await updatePrefs(uid, tablet.id, { notifications_enabled: true, uncaught_nearby: true });
    const originalFetch = globalThis.fetch;
    const payloads: Array<{
      to: string;
      data: {
        kind?: string;
        ticker?: string;
        mapvest: { deliveryId: string; installationId: string; target: { type: string } };
      };
      categoryId?: string;
    }> = [];
    globalThis.fetch = (async (_input, init) => {
      const batch = JSON.parse(String(init?.body)) as typeof payloads;
      payloads.push(...batch);
      return new Response(
        JSON.stringify({
          data: batch.map(() => ({ status: "ok", id: crypto.randomUUID() })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const tokens = await listTokensForEvent("uncaught_nearby");
      const result = await deliverPush({
        tokens,
        dedupe: [{ slot: "uncaught:test", key: "one" }],
        eventKey: "uncaught_nearby",
        title: "Nearby",
        body: "JPM is nearby",
        data: { kind: "uncaught_nearby", ticker: "JPM" },
        target: { type: "map", placeId: "place-jpm", ticker: "JPM", lat: 40, lng: -74 },
      });
      expect(result.successes).toBe(2);
      expect(new Set(payloads.map((payload) => payload.data.mapvest.deliveryId)).size).toBe(2);
      expect(new Set(payloads.map((payload) => payload.data.mapvest.installationId))).toEqual(
        new Set([phone.id, tablet.id]),
      );
      expect(payloads.every((payload) => payload.data.mapvest.target.type === "map")).toBe(true);
      expect(payloads.every((payload) => payload.categoryId === "mapvest-map-v1")).toBe(true);
      expect(payloads.map((payload) => [payload.data.kind, payload.data.ticker])).toEqual([
        ["uncaught_nearby", "JPM"],
        ["uncaught_nearby", "JPM"],
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("production fails closed before network handoff without Expo push security", async () => {
    const uid = userId();
    const token = await registerPushToken(uid, expoToken(), "ios", "phone");
    await updatePrefs(uid, token.id, { notifications_enabled: true, daily_brief: true });
    const originalFetch = globalThis.fetch;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSecurity = process.env.EXPO_PUSH_SECURITY_ENABLED;
    const originalAccessToken = process.env.EXPO_ACCESS_TOKEN;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    process.env.NODE_ENV = "production";
    Reflect.deleteProperty(process.env, "EXPO_PUSH_SECURITY_ENABLED");
    Reflect.deleteProperty(process.env, "EXPO_ACCESS_TOKEN");
    try {
      const result = await deliverPush({
        tokens: [token],
        dedupe: [{ slot: "daily_brief", key: "production-guard" }],
        eventKey: "daily_brief",
        title: "Morning read",
        body: "Ready",
        target: { type: "home", section: "daily-brief" },
      });
      expect(result).toMatchObject({ successes: 0, failures: 1 });
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
      process.env.NODE_ENV = originalNodeEnv;
      if (originalSecurity === undefined)
        Reflect.deleteProperty(process.env, "EXPO_PUSH_SECURITY_ENABLED");
      else process.env.EXPO_PUSH_SECURITY_ENABLED = originalSecurity;
      if (originalAccessToken === undefined)
        Reflect.deleteProperty(process.env, "EXPO_ACCESS_TOKEN");
      else process.env.EXPO_ACCESS_TOKEN = originalAccessToken;
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

    const omittedRead = await app.fetch(
      new Request("http://localhost/v1/push/prefs", {
        headers: { Authorization: `Bearer ${bearer}` },
      }),
    );
    expect(omittedRead.status).toBe(200);
    expect(await omittedRead.json()).toEqual({ prefs: {}, tokenId: null });
  });

  test("an omitted or stale preference read never selects a sibling device", async () => {
    const uid = userId();
    const bearer = await sessionFor(uid, `${uid}@mapvest.dev`);
    const phone = await registerPushToken(uid, expoToken(), "ios", "phone");
    const tablet = await registerPushToken(uid, expoToken(), "ios", "tablet");
    await updatePrefs(uid, phone.id, { notifications_enabled: true, local_brief: true });
    await updatePrefs(uid, tablet.id, { notifications_enabled: true, local_brief: false });

    const omitted = await app.fetch(
      new Request("http://localhost/v1/push/prefs", {
        headers: { Authorization: `Bearer ${bearer}` },
      }),
    );
    expect(await omitted.json()).toEqual({ prefs: {}, tokenId: null });

    const stale = await app.fetch(
      new Request("http://localhost/v1/push/prefs?tokenId=push_missing", {
        headers: { Authorization: `Bearer ${bearer}` },
      }),
    );
    expect(await stale.json()).toEqual({ prefs: {}, tokenId: null });

    const exactTablet = await app.fetch(
      new Request(`http://localhost/v1/push/prefs?tokenId=${tablet.id}`, {
        headers: { Authorization: `Bearer ${bearer}` },
      }),
    );
    expect(await exactTablet.json()).toMatchObject({
      tokenId: tablet.id,
      prefs: { local_brief: false },
    });
  });
});

describe("location-derived push delivery", () => {
  test("the interactive local-brief request never sends a redundant push", async () => {
    const uid = userId();
    const bearer = await sessionFor(uid, `${uid}@mapvest.dev`);
    const token = await registerPushToken(uid, expoToken(), "ios", "phone");
    await updatePrefs(uid, token.id, { notifications_enabled: true, local_brief: true });
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input) => {
      requestedUrls.push(String(input));
      // The local-brief generator fails soft when its optional enrichments are
      // unavailable, so an empty successful body is enough for this route test.
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const response = await app.fetch(
        new Request("http://localhost/v1/local-brief", {
          method: "POST",
          headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body: JSON.stringify({ lat: 40.7128, lng: -74.006 }),
        }),
      );
      expect(response.status).toBe(200);
      expect(requestedUrls).not.toContain("https://exp.host/--/api/v2/push/send");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a local brief generated from one device delivers only to that device", async () => {
    const uid = userId();
    const phone = await registerPushToken(uid, expoToken(), "ios", "phone");
    const tablet = await registerPushToken(uid, expoToken(), "ios", "tablet");
    await updatePrefs(uid, phone.id, { notifications_enabled: true, local_brief: true });
    await updatePrefs(uid, tablet.id, { notifications_enabled: true, local_brief: true });
    const originalFetch = globalThis.fetch;
    const payloads: Array<{ to?: string }> = [];
    globalThis.fetch = (async (_input, init) => {
      payloads.push(...(JSON.parse(String(init?.body)) as Array<{ to?: string }>));
      return new Response(JSON.stringify({ data: [{ status: "ok", id: "ticket" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      await onLocalBriefGenerated(
        phone,
        {
          paragraphs: ["A current reading of this area."],
          place: { city: "New York", state: "New York" },
          nearbyCount: 1,
          generatedAt: "2026-08-25T12:00:00.000Z",
        },
        { lat: 40.7128, lng: -74.006 },
      );
      expect(payloads.map((payload) => payload.to)).toEqual([phone.expoToken]);
      expect(payloads.map((payload) => payload.to)).not.toContain(tablet.expoToken);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
