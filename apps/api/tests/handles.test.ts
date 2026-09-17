import { beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { app } from "../src/index.js";
import { isValidHandleFormat } from "../src/lib/handles.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import { __resetStore, findOrCreateUserByEmail, renameHandle } from "../src/lib/store.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";

function url(path: string) {
  return `http://localhost/v1${path}`;
}

let emailCounter = 0;
function freshEmail(): string {
  emailCounter += 1;
  return `handles-test-${emailCounter}@mapvest.dev`;
}

async function loginAs(email: string): Promise<string> {
  let captured: string | undefined;
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const m = args.join(" ").match(/token=([\w.-]+)/);
    if (m) captured = m[1];
  };
  try {
    await app.fetch(
      new Request(url("/auth/request-magic-link"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      }),
    );
  } finally {
    console.log = originalLog;
  }
  const verifyRes = await app.fetch(
    new Request(url("/auth/verify"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: captured }),
    }),
  );
  const { session } = (await verifyRes.json()) as { session: { token: string } };
  return session.token;
}

function authed(path: string, token: string, init?: RequestInit) {
  return app.fetch(
    new Request(url(path), {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    }),
  );
}

beforeEach(() => {
  __resetStore();
  __resetMetrics();
  __resetRateLimit();
});

describe("account creation grants a public handle", () => {
  test("every new account gets a finder-<8hex> handle matching the public format", async () => {
    const user = await findOrCreateUserByEmail(freshEmail());
    expect(user.handle).toBeDefined();
    expect(user.handle).toMatch(/^finder-[0-9a-f]{8}$/);
    expect(isValidHandleFormat(user.handle as string)).toBe(true);
  });

  test("two accounts never land the same handle", async () => {
    const a = await findOrCreateUserByEmail(freshEmail());
    const b = await findOrCreateUserByEmail(freshEmail());
    expect(a.handle).not.toBe(b.handle);
  });

  test("uniqueness constraint holds even when a second account targets the same handle", async () => {
    const a = await findOrCreateUserByEmail(freshEmail());
    const b = await findOrCreateUserByEmail(freshEmail());

    const clash = await renameHandle(b.id, a.handle as string);
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.code).toBe("handle_taken");
  });
});

describe("POST /v1/settings/handle", () => {
  test("requires auth", async () => {
    const res = await app.fetch(
      new Request(url("/settings/handle"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "no-auth-here" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("GET /v1/settings surfaces the handle", async () => {
    const token = await loginAs(freshEmail());
    const res = await authed("/settings", token, { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { handle?: string } };
    expect(body.user.handle).toMatch(/^finder-[0-9a-f]{8}$/);
  });

  describe("format validation table", () => {
    test.each([
      ["abc", true],
      ["finder-99", true],
      ["a-b-c-d-e-f-g-h-i-j", true],
      ["UPPER-OK", true], // normalized to lowercase before validation
      ["ab", false], // too short
      [`${"a".repeat(21)}`, false], // too long
      ["has space", false],
      ["under_score", false],
      ["dots.not.ok", false],
      ["emoji-🔥", false],
    ])("%s -> valid=%s", async (candidate: string, expectedValid: boolean) => {
      const token = await loginAs(freshEmail());
      const res = await authed("/settings/handle", token, {
        method: "POST",
        body: JSON.stringify({ handle: candidate }),
      });
      if (expectedValid) {
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ok: true; handle: string };
        expect(body.handle).toBe(candidate.toLowerCase());
      } else {
        expect(res.status).toBe(400);
        const body = (await res.json()) as { code: string };
        expect(body.code).toBe("invalid_format");
      }
    });
  });

  test("rejects a handle already taken by another account, case-insensitively", async () => {
    const tokenA = await loginAs(freshEmail());
    const tokenB = await loginAs(freshEmail());

    const renameA = await authed("/settings/handle", tokenA, {
      method: "POST",
      body: JSON.stringify({ handle: "shared-target" }),
    });
    expect(renameA.status).toBe(200);

    const renameB = await authed("/settings/handle", tokenB, {
      method: "POST",
      body: JSON.stringify({ handle: "SHARED-TARGET" }),
    });
    expect(renameB.status).toBe(409);
    const body = (await renameB.json()) as { code: string };
    expect(body.code).toBe("handle_taken");
  });

  test("a second rename inside 24h is rate limited, with a clear code distinct from format/collision", async () => {
    const token = await loginAs(freshEmail());

    const first = await authed("/settings/handle", token, {
      method: "POST",
      body: JSON.stringify({ handle: "cooldown-one" }),
    });
    expect(first.status).toBe(200);

    const second = await authed("/settings/handle", token, {
      method: "POST",
      body: JSON.stringify({ handle: "cooldown-two" }),
    });
    expect(second.status).toBe(429);
    const body = (await second.json()) as { code: string; retryAfterSec: number };
    expect(body.code).toBe("rate_limited");
    expect(body.retryAfterSec).toBeGreaterThan(0);
  });
});
