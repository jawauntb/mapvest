import { beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { app } from "../src/index.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import { __resetStore } from "../src/lib/store.js";
import { _clearBriefCache } from "../src/lib/watchlist-brief.js";
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

type ListDto = { id: string; name: string; isDefault: boolean; tickerCount?: number };

beforeEach(() => {
  __resetStore();
  __resetMetrics();
  __resetRateLimit();
  _clearBriefCache();
});

describe("watchlist lists routes — default reassignment", () => {
  test("set-default requires auth", async () => {
    const res = await app.fetch(
      new Request(url("/watchlist/lists/wl_x/default"), { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  test("promoting a list demotes the previous default and flips delete protection", async () => {
    const token = await loginAs("default-flip@mapvest.dev");

    const listsRes = await authed("/watchlist/lists", token);
    expect(listsRes.status).toBe(200);
    const initial = ((await listsRes.json()) as { lists: ListDto[] }).lists;
    const original = initial.find((l) => l.isDefault)!;
    expect(original).toBeDefined();

    const createRes = await authed("/watchlist/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "nypc" }),
    });
    expect(createRes.status).toBe(200);
    const nypc = ((await createRes.json()) as { list: ListDto }).list;
    expect(nypc.isDefault).toBe(false);

    const promoteRes = await authed(`/watchlist/lists/${nypc.id}/default`, token, {
      method: "POST",
    });
    expect(promoteRes.status).toBe(200);
    const promoted = ((await promoteRes.json()) as { list: ListDto }).list;
    expect(promoted.id).toBe(nypc.id);
    expect(promoted.isDefault).toBe(true);

    const afterRes = await authed("/watchlist/lists", token);
    const after = ((await afterRes.json()) as { lists: ListDto[] }).lists;
    expect(after.filter((l) => l.isDefault).map((l) => l.id)).toEqual([nypc.id]);
    // Default-first ordering.
    expect(after[0]?.id).toBe(nypc.id);

    // The new default is delete-protected; the old one is not.
    const delNew = await authed(`/watchlist/lists/${nypc.id}`, token, { method: "DELETE" });
    expect(delNew.status).toBe(400);
    const delOld = await authed(`/watchlist/lists/${original.id}`, token, { method: "DELETE" });
    expect(delOld.status).toBe(204);
  });

  test("promoting an unknown list 404s", async () => {
    const token = await loginAs("default-missing@mapvest.dev");
    const res = await authed("/watchlist/lists/wl_nope/default", token, { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("default GET /watchlist follows the reassigned default", async () => {
    const token = await loginAs("default-entries@mapvest.dev");

    const createRes = await authed("/watchlist/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "nypc" }),
    });
    const nypc = ((await createRes.json()) as { list: ListDto }).list;

    const addRes = await authed("/watchlist/add", token, {
      method: "POST",
      body: JSON.stringify({ ticker: "MSGS", source: "manual", listId: nypc.id }),
    });
    expect(addRes.status).toBe(200);

    // Default list is still empty.
    let itemsRes = await authed("/watchlist", token);
    let items = ((await itemsRes.json()) as { items: Array<{ ticker: string }> }).items;
    expect(items.length).toBe(0);

    await authed(`/watchlist/lists/${nypc.id}/default`, token, { method: "POST" });

    itemsRes = await authed("/watchlist", token);
    items = ((await itemsRes.json()) as { items: Array<{ ticker: string }> }).items;
    expect(items.map((i) => i.ticker)).toEqual(["MSGS"]);
  });
});

describe("watchlist brief route — per-list briefs", () => {
  test("brief accepts listId and serves the empty brief for an empty list", async () => {
    const token = await loginAs("brief-list@mapvest.dev");
    const createRes = await authed("/watchlist/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "empty list" }),
    });
    const list = ((await createRes.json()) as { list: ListDto }).list;

    const res = await authed(`/watchlist/brief?listId=${list.id}`, token);
    expect(res.status).toBe(200);
    const brief = (await res.json()) as { headline: string; body: string; generatedAt: string };
    expect(brief.headline.length).toBeGreaterThan(0);
    expect(brief.generatedAt).toEqual(expect.any(String));
  });

  test("brief without listId stays 200 for the default list", async () => {
    const token = await loginAs("brief-default@mapvest.dev");
    const res = await authed("/watchlist/brief", token);
    expect(res.status).toBe(200);
    const brief = (await res.json()) as { headline: string };
    expect(brief.headline.length).toBeGreaterThan(0);
  });
});
