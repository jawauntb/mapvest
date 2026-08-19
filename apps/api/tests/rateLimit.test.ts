import { beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { Hono } from "hono";
import { sign } from "hono/jwt";
import { __resetRateLimit, rateLimit } from "../src/middleware/rateLimit.js";

beforeEach(() => {
  __resetRateLimit();
});

describe("rate limit middleware", () => {
  test("allows up to the limit and then 429s", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ limit: 3, windowMs: 60_000 }));
    app.get("/", (c) => c.text("ok"));

    async function hit() {
      return app.fetch(
        new Request("http://localhost/", { headers: { "x-forwarded-for": "1.2.3.4" } }),
      );
    }
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200);
    const blocked = await hit();
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: string; retryAfter: number };
    expect(body.error).toBe("rate limit exceeded");
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  test("separate IPs get separate buckets", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ limit: 1, windowMs: 60_000 }));
    app.get("/", (c) => c.text("ok"));

    const first = await app.fetch(
      new Request("http://localhost/", { headers: { "x-forwarded-for": "9.9.9.9" } }),
    );
    expect(first.status).toBe(200);
    const second = await app.fetch(
      new Request("http://localhost/", { headers: { "x-forwarded-for": "9.9.9.9" } }),
    );
    expect(second.status).toBe(429);
    const otherIp = await app.fetch(
      new Request("http://localhost/", { headers: { "x-forwarded-for": "8.8.8.8" } }),
    );
    expect(otherIp.status).toBe(200);
  });

  test("sets X-RateLimit headers", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ limit: 5, windowMs: 60_000 }));
    app.get("/", (c) => c.text("ok"));
    const res = await app.fetch(
      new Request("http://localhost/", { headers: { "x-forwarded-for": "7.7.7.7" } }),
    );
    expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("4");
  });

  test("does not count OPTIONS, HEAD, or health", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ limit: 1, windowMs: 60_000 }));
    app.all("*", (c) => c.text("ok"));

    const opts = await app.fetch(
      new Request("http://localhost/v1/quote", {
        method: "OPTIONS",
        headers: { "x-forwarded-for": "3.3.3.3" },
      }),
    );
    expect(opts.status).toBe(200);

    const health = await app.fetch(
      new Request("http://localhost/v1/health", {
        headers: { "x-forwarded-for": "3.3.3.3" },
      }),
    );
    expect(health.status).toBe(200);

    const real = await app.fetch(
      new Request("http://localhost/v1/quote", {
        headers: { "x-forwarded-for": "3.3.3.3" },
      }),
    );
    expect(real.status).toBe(200);
    const blocked = await app.fetch(
      new Request("http://localhost/v1/quote", {
        headers: { "x-forwarded-for": "3.3.3.3" },
      }),
    );
    expect(blocked.status).toBe(429);
  });

  test("device id splits the bucket even on one IP", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ limit: 1, windowMs: 60_000 }));
    app.get("/", (c) => c.text("ok"));

    const a = await app.fetch(
      new Request("http://localhost/", {
        headers: { "x-forwarded-for": "4.4.4.4", "x-device-id": "phone" },
      }),
    );
    expect(a.status).toBe(200);
    const a2 = await app.fetch(
      new Request("http://localhost/", {
        headers: { "x-forwarded-for": "4.4.4.4", "x-device-id": "phone" },
      }),
    );
    expect(a2.status).toBe(429);
    const b = await app.fetch(
      new Request("http://localhost/", {
        headers: { "x-forwarded-for": "4.4.4.4", "x-device-id": "laptop" },
      }),
    );
    expect(b.status).toBe(200);
  });

  test("session subject splits the bucket from anonymous IP traffic", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ limit: 1, windowMs: 60_000 }));
    app.get("/", (c) => c.text("ok"));

    const token = await sign(
      {
        sub: "user-42",
        purpose: "session",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      process.env.SESSION_SIGNING_KEY as string,
      "HS256",
    );

    const anon = await app.fetch(
      new Request("http://localhost/", { headers: { "x-forwarded-for": "5.5.5.5" } }),
    );
    expect(anon.status).toBe(200);
    const anon2 = await app.fetch(
      new Request("http://localhost/", { headers: { "x-forwarded-for": "5.5.5.5" } }),
    );
    expect(anon2.status).toBe(429);

    const authed = await app.fetch(
      new Request("http://localhost/", {
        headers: {
          "x-forwarded-for": "5.5.5.5",
          Authorization: `Bearer ${token}`,
        },
      }),
    );
    expect(authed.status).toBe(200);
  });
});
