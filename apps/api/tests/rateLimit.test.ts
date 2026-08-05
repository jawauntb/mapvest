import { beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { Hono } from "hono";
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
});
