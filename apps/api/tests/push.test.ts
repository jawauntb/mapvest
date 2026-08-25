import { beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { sign } from "hono/jwt";
import { app } from "../src/index.js";
import {
  _resetPushTokenMemory,
  listTokensForEvent,
  listTokensForUserAndEvent,
  registerPushToken,
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

describe("push prefs route", () => {
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
  });
});
