import { beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";
process.env.ADMIN_EMAILS = "admin@mapvest.dev";

import { app } from "../src/index.js";
import { __resetStore } from "../src/lib/store.js";
import { __resetMetrics } from "../src/lib/metrics.js";
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
  if (!captured) throw new Error("no magic link captured");
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

describe("admin routes", () => {
  test("non-admin cannot reach /admin/metrics", async () => {
    const token = await loginAs("user@mapvest.dev");
    const res = await app.fetch(
      new Request(url("/admin/metrics"), { headers: { Authorization: `Bearer ${token}` } }),
    );
    expect(res.status).toBe(403);
  });

  test("no auth header is 401 on /admin/metrics", async () => {
    const res = await app.fetch(new Request(url("/admin/metrics")));
    expect(res.status).toBe(401);
  });

  test("admin can reach /admin/metrics, /admin/users, /admin/log", async () => {
    const token = await loginAs("admin@mapvest.dev");

    // Also hit a non-admin route to seed some metrics data.
    await app.fetch(new Request(url("/health")));

    const metricsRes = await app.fetch(
      new Request(url("/admin/metrics"), { headers: { Authorization: `Bearer ${token}` } }),
    );
    expect(metricsRes.status).toBe(200);
    const metrics = (await metricsRes.json()) as {
      total: number;
      p95: number;
      perPath: Record<string, number>;
    };
    expect(metrics.total).toBeGreaterThan(0);
    expect(typeof metrics.p95).toBe("number");

    const usersRes = await app.fetch(
      new Request(url("/admin/users"), { headers: { Authorization: `Bearer ${token}` } }),
    );
    expect(usersRes.status).toBe(200);
    const usersBody = (await usersRes.json()) as { users: Array<{ email: string; scopes: string[] }> };
    const admin = usersBody.users.find((u) => u.email === "admin@mapvest.dev");
    expect(admin?.scopes).toContain("admin");

    const logRes = await app.fetch(
      new Request(url("/admin/log?limit=10"), { headers: { Authorization: `Bearer ${token}` } }),
    );
    expect(logRes.status).toBe(200);
    const logBody = (await logRes.json()) as { entries: Array<{ path: string }> };
    expect(logBody.entries.length).toBeGreaterThan(0);
  });
});
