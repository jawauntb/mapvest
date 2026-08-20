import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

// Set env BEFORE anything else imports the env module.
process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";
process.env.ADMIN_EMAILS = "admin@mapvest.dev";

import { app } from "../src/index.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import { __resetStore } from "../src/lib/store.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";

function url(path: string) {
  return `http://localhost/v1${path}`;
}

beforeEach(() => {
  __resetStore();
  __resetMetrics();
  __resetRateLimit();
});

describe("auth flow", () => {
  test("request-magic-link returns { sent: true }", async () => {
    const res = await app.fetch(
      new Request(url("/auth/request-magic-link"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@mapvest.dev" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent: boolean };
    expect(body.sent).toBe(true);
  });

  test("request-magic-link rejects a bad email", async () => {
    const res = await app.fetch(
      new Request(url("/auth/request-magic-link"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("verify consumes the magic token and returns a session", async () => {
    // Capture the printed magic link
    const originalLog = console.log;
    let capturedLink: string | undefined;
    console.log = (...args: unknown[]) => {
      const line = args.join(" ");
      const m = line.match(/token=([\w.-]+)/);
      if (m) capturedLink = m[1];
    };
    try {
      const r1 = await app.fetch(
        new Request(url("/auth/request-magic-link"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "user@mapvest.dev" }),
        }),
      );
      expect(r1.status).toBe(200);
    } finally {
      console.log = originalLog;
    }

    expect(capturedLink).toBeDefined();
    const r2 = await app.fetch(
      new Request(url("/auth/verify"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: capturedLink }),
      }),
    );
    expect(r2.status).toBe(200);
    const body = (await r2.json()) as {
      session: { token: string; userId: string; expiresAt: string };
    };
    expect(body.session.token).toEqual(expect.any(String));
    expect(body.session.userId).toMatch(/^usr_/);

    // A second verify with the same token must fail (single-use).
    const r3 = await app.fetch(
      new Request(url("/auth/verify"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: capturedLink }),
      }),
    );
    expect(r3.status).toBe(401);
  });

  test("me returns the authenticated user", async () => {
    // Set up: request + verify to get a session token.
    let capturedLink: string | undefined;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const m = args.join(" ").match(/token=([\w.-]+)/);
      if (m) capturedLink = m[1];
    };
    try {
      await app.fetch(
        new Request(url("/auth/request-magic-link"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "user@mapvest.dev" }),
        }),
      );
    } finally {
      console.log = originalLog;
    }

    const verifyRes = await app.fetch(
      new Request(url("/auth/verify"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: capturedLink }),
      }),
    );
    const { session } = (await verifyRes.json()) as { session: { token: string } };

    const meRes = await app.fetch(
      new Request(url("/auth/me"), {
        headers: { Authorization: `Bearer ${session.token}` },
      }),
    );
    expect(meRes.status).toBe(200);
    const body = (await meRes.json()) as { user: { email: string; scopes: string[] } };
    expect(body.user.email).toBe("user@mapvest.dev");
    expect(body.user.scopes).toContain("user");
  });

  test("me refuses missing / invalid tokens", async () => {
    const r1 = await app.fetch(new Request(url("/auth/me")));
    expect(r1.status).toBe(401);

    const r2 = await app.fetch(
      new Request(url("/auth/me"), { headers: { Authorization: "Bearer garbage" } }),
    );
    expect(r2.status).toBe(401);
  });
});
