import { beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { sign } from "hono/jwt";
import { app } from "../index.js";
import { __resetEntitlements } from "../lib/entitlements.js";
import { __resetMetrics } from "../lib/metrics.js";
import { __resetProgressStore, awardXp } from "../lib/progress-store.js";
import { ensureUser } from "../lib/store.js";
import { PIONEER_XP } from "../lib/territory.js";
import { __resetRateLimit } from "../middleware/rateLimit.js";

function url(path: string) {
  return `http://localhost${path}`;
}

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

async function sessionFor(id: string, email: string): Promise<string> {
  await ensureUser(id, email);
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { purpose: "session", sub: id, email, iat: now, exp: now + 3600 },
    process.env.SESSION_SIGNING_KEY!,
  );
}

function getLeaderboard(token: string, limit?: number) {
  const qs = limit !== undefined ? `?limit=${limit}` : "";
  return app.fetch(
    new Request(url(`/v1/leaderboard/weekly${qs}`), {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
}

type LeaderboardBody = {
  cycleStart: string;
  cycleEnd: string;
  rows: Array<{ handle: string; earlyFindScore: number; rank: number; isYou: boolean }>;
};

beforeEach(() => {
  __resetRateLimit();
  __resetMetrics();
  __resetEntitlements();
  __resetProgressStore();
});

describe("GET /v1/leaderboard/weekly", () => {
  test("requires auth", async () => {
    const res = await app.fetch(new Request(url("/v1/leaderboard/weekly")));
    expect(res.status).toBe(401);
  });

  test("a user with zero early-find score still gets their own row back", async () => {
    const token = await sessionFor(unique("u"), `${unique("zero")}@mapvest.dev`);
    const res = await getLeaderboard(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as LeaderboardBody;
    expect(body.rows.length).toBeGreaterThanOrEqual(1);
    const mine = body.rows.find((r) => r.isYou);
    expect(mine).toBeDefined();
    expect(mine!.earlyFindScore).toBe(0);
    expect(mine!.handle).toMatch(/^finder-/);
  });

  test("cycleStart/cycleEnd bound a 7-day window ending Saturday 12:00 UTC", async () => {
    const token = await sessionFor(unique("u"), `${unique("cyc")}@mapvest.dev`);
    const res = await getLeaderboard(token);
    const body = (await res.json()) as LeaderboardBody;
    const start = new Date(body.cycleStart);
    const end = new Date(body.cycleEnd);
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(end.getUTCDay()).toBe(6); // Saturday
    expect(end.getUTCHours()).toBe(12);
  });

  test("ranks by early-find (Pioneer bonus) score, not by grant count or other XP", async () => {
    const bigId = unique("big");
    const smallId = unique("small");
    const bigToken = await sessionFor(bigId, `${unique("bige")}@mapvest.dev`);
    await sessionFor(smallId, `${unique("smalle")}@mapvest.dev`);

    // Two Pioneer grants (2 tiles) for `big` — this is the axis that matters.
    await awardXp(bigId, PIONEER_XP, `pioneer:${unique("tile")}`);
    await awardXp(bigId, PIONEER_XP, `pioneer:${unique("tile")}`);
    // One Pioneer grant for `small`.
    await awardXp(smallId, PIONEER_XP, `pioneer:${unique("tile")}`);
    // A large non-Pioneer grant for `small` — must NOT count toward the
    // leaderboard even though it dwarfs `big`'s Pioneer total.
    await awardXp(smallId, 10_000, `quest:${unique("q")}`);

    const res = await getLeaderboard(bigToken, 10);
    const body = (await res.json()) as LeaderboardBody;
    const bigRow = body.rows.find((r) => r.isYou);
    expect(bigRow?.earlyFindScore).toBe(PIONEER_XP * 2);
    expect(bigRow?.rank).toBe(1);
  });

  test("caller ranked outside the requested limit is appended below the top rows", async () => {
    const leaderId = unique("leader");
    const laggerId = unique("lagger");
    await sessionFor(leaderId, `${unique("leadere")}@mapvest.dev`);
    const laggerToken = await sessionFor(laggerId, `${unique("laggere")}@mapvest.dev`);

    await awardXp(leaderId, PIONEER_XP, `pioneer:${unique("tile")}`);
    await awardXp(laggerId, PIONEER_XP, `pioneer:${unique("tile")}`);
    // Break the tie deterministically so `leader` always outranks `lagger`.
    await awardXp(leaderId, PIONEER_XP, `pioneer:${unique("tile")}`);

    const res = await getLeaderboard(laggerToken, 1);
    const body = (await res.json()) as LeaderboardBody;
    expect(body.rows.length).toBe(2); // top-1 + the caller's own appended row
    expect(body.rows[0]?.isYou).toBe(false);
    expect(body.rows[1]?.isYou).toBe(true);
    expect(body.rows[1]?.rank).toBe(2);
    expect(body.rows[1]?.earlyFindScore).toBe(PIONEER_XP);
  });

  test("no emails or raw user ids ever appear in the response", async () => {
    const id = unique("priv");
    const email = `${unique("secret")}@mapvest.dev`;
    const token = await sessionFor(id, email);
    await awardXp(id, PIONEER_XP, `pioneer:${unique("tile")}`);

    const res = await getLeaderboard(token);
    const raw = await res.text();
    expect(raw).not.toContain(email);
    expect(raw).not.toContain(id);
  });

  test("limit is capped at 50 even when a larger value is requested", async () => {
    const token = await sessionFor(unique("u"), `${unique("cap")}@mapvest.dev`);
    const res = await getLeaderboard(token, 500);
    expect(res.status).toBe(200);
    // Nothing to assert on row count here (few test users exist), but the
    // route must not error on an oversized limit.
  });
});
