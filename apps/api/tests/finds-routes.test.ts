import { afterEach, beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { app } from "../src/index.js";
import { __resetFindsStore, listFinds } from "../src/lib/finds-store.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import { __resetStore } from "../src/lib/store.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";

function url(path: string) {
  return `http://localhost/v1${path}`;
}

async function loginAs(email: string): Promise<{ token: string; userId: string }> {
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
  const body = (await verifyRes.json()) as {
    session: { token: string; userId: string };
  };
  return { token: body.session.token, userId: body.session.userId };
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
  __resetFindsStore();
  __resetMetrics();
  __resetRateLimit();
});

afterEach(() => {
  __resetFindsStore();
});

describe("POST /v1/finds", () => {
  test("requires a bearer session", async () => {
    const res = await app.fetch(
      new Request(url("/finds"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          finds: [{ brand: "Nike", ticker: "NKE", isPublic: true, confidence: "high" }],
        }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("rejects an empty or malformed body", async () => {
    const { token } = await loginAs("finds-empty@mapvest.dev");
    const empty = await authed("/finds", token, {
      method: "POST",
      body: JSON.stringify({ finds: [] }),
    });
    expect(empty.status).toBe(400);
    const bad = await authed("/finds", token, {
      method: "POST",
      body: JSON.stringify({ finds: [{ brand: "", confidence: "high" }] }),
    });
    expect(bad.status).toBe(400);
  });

  test("replays guest finds onto the account and is identity-idempotent", async () => {
    const { token, userId } = await loginAs("finds-replay@mapvest.dev");
    const first = await authed("/finds", token, {
      method: "POST",
      body: JSON.stringify({
        finds: [
          {
            brand: "Nike",
            ticker: "NKE",
            isPublic: true,
            confidence: "high",
            createdAt: "2026-09-01T12:00:00.000Z",
          },
          {
            brand: "In-house",
            isPublic: false,
            comparable: "SBUX",
            confidence: "medium",
            createdAt: "2026-09-02T12:00:00.000Z",
          },
        ],
      }),
    });
    expect(first.status).toBe(200);
    const body = (await first.json()) as {
      finds: { brand: string; createdAt: string }[];
      count: number;
    };
    expect(body.count).toBe(2);
    expect(body.finds.map((f) => f.brand)).toEqual(["In-house", "Nike"]);
    expect(body.finds.find((f) => f.brand === "Nike")?.createdAt).toBe("2026-09-01T12:00:00.000Z");

    const recatch = await authed("/finds", token, {
      method: "POST",
      body: JSON.stringify({
        finds: [{ brand: "Nike", ticker: "NKE", isPublic: true, confidence: "low" }],
      }),
    });
    expect(recatch.status).toBe(200);
    const again = (await recatch.json()) as { count: number };
    expect(again.count).toBe(2);
    const stored = await listFinds(userId);
    expect(stored).toHaveLength(2);
  });
});
