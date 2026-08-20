import { beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { app } from "../src/index.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import { __resetStore } from "../src/lib/store.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";

function url(path: string) {
  return `http://localhost/v1${path}`;
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

beforeEach(() => {
  __resetStore();
  __resetMetrics();
  __resetRateLimit();
});

describe("maps-token + places proxy", () => {
  test("maps-token requires auth", async () => {
    const res = await app.fetch(new Request(url("/session/maps-token"), { method: "POST" }));
    expect(res.status).toBe(401);
  });

  test("maps-token returns a 60-min JWT", async () => {
    const sessionToken = await loginAs("user@mapvest.dev");
    const res = await app.fetch(
      new Request(url("/session/maps-token"), {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: string };
    expect(body.token).toEqual(expect.any(String));
    const secondsFromNow = (new Date(body.expiresAt).getTime() - Date.now()) / 1000;
    expect(secondsFromNow).toBeGreaterThan(59 * 60);
    expect(secondsFromNow).toBeLessThanOrEqual(60 * 60 + 5);
  });

  test("proxy/places rejects a missing token", async () => {
    const res = await app.fetch(
      new Request(url("/proxy/places?location=37.77,-122.42&radius=500")),
    );
    expect(res.status).toBe(401);
  });

  test("proxy/places rejects a session token (wrong purpose)", async () => {
    const sessionToken = await loginAs("user@mapvest.dev");
    const res = await app.fetch(
      new Request(url("/proxy/places?location=37.77,-122.42&radius=500"), {
        headers: { Authorization: `Bearer ${sessionToken}` },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("proxy/places validates the location arg", async () => {
    const sessionToken = await loginAs("user@mapvest.dev");
    const mapsRes = await app.fetch(
      new Request(url("/session/maps-token"), {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
      }),
    );
    const { token: mapsToken } = (await mapsRes.json()) as { token: string };
    const res = await app.fetch(
      new Request(url("/proxy/places?location=notalatlng"), {
        headers: { Authorization: `Bearer ${mapsToken}` },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("proxy/places forwards to Google when the token is valid (mocked fetch)", async () => {
    const sessionToken = await loginAs("user@mapvest.dev");
    const mapsRes = await app.fetch(
      new Request(url("/session/maps-token"), {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
      }),
    );
    const { token: mapsToken } = (await mapsRes.json()) as { token: string };

    process.env.GOOGLE_MAPS_API_KEY = "fake-google-key";
    const originalFetch = globalThis.fetch;
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (input: URL | Request | string) => {
      const s =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      capturedUrl = s;
      return new Response(JSON.stringify({ results: [{ place_id: "abc" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const res = await app.fetch(
        new Request(url("/proxy/places?location=37.77,-122.42&radius=500"), {
          headers: { Authorization: `Bearer ${mapsToken}` },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { results: Array<{ place_id: string }> };
      expect(body.results[0]?.place_id).toBe("abc");
      expect(capturedUrl).toContain("maps.googleapis.com");
      expect(capturedUrl).toContain("key=fake-google-key");
      expect(capturedUrl).toContain("location=37.77%2C-122.42");
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.GOOGLE_MAPS_API_KEY;
    }
  });
});
