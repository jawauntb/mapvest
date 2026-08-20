import { describe, expect, test } from "bun:test";
import { UserProgress } from "@mapvest/core";
import {
  XP_PER_FIND,
  applyFind,
  applyXpGrant,
  awardBadge,
  awardXp,
  bumpProgressOnFind,
  dayDiff,
  defaultProgress,
  getProgress,
  levelForXp,
  utcDay,
} from "../src/lib/progress-store.js";

/**
 * Offline-only: `applyFind` is pure, and the store exercises the in-memory
 * path (POSTGRES_URL is unset in the test env).
 */

/** Build a progress row at a known state. */
function at(partial: Partial<UserProgress>): UserProgress {
  return { ...defaultProgress(), ...partial };
}

describe("applyFind (pure progression rule)", () => {
  test("first find ever starts the streak at 1 and awards XP", () => {
    const next = applyFind(defaultProgress(), "2026-08-19");
    expect(next.xp).toBe(10);
    expect(next.level).toBe(1);
    expect(next.streakDays).toBe(1);
    expect(next.streakFreezes).toBe(0);
    expect(next.lastFindDay).toBe("2026-08-19");
    UserProgress.parse(next);
  });

  test("a second find on the same UTC day awards XP but leaves the streak alone", () => {
    const start = at({ xp: 40, level: 1, streakDays: 4, lastFindDay: "2026-08-19" });
    const next = applyFind(start, "2026-08-19");
    expect(next.xp).toBe(50);
    expect(next.streakDays).toBe(4);
    expect(next.lastFindDay).toBe("2026-08-19");
  });

  test("a find the next day extends the streak", () => {
    const start = at({ xp: 40, streakDays: 4, lastFindDay: "2026-08-19" });
    const next = applyFind(start, "2026-08-20");
    expect(next.streakDays).toBe(5);
    expect(next.streakFreezes).toBe(0);
    expect(next.lastFindDay).toBe("2026-08-20");
  });

  test("streak extension crosses a month boundary correctly", () => {
    const next = applyFind(at({ streakDays: 3, lastFindDay: "2026-08-31" }), "2026-09-01");
    expect(next.streakDays).toBe(4);
  });

  test("exactly one missed day with a freeze in inventory spends it and extends", () => {
    const start = at({ xp: 100, streakDays: 9, streakFreezes: 2, lastFindDay: "2026-08-17" });
    const next = applyFind(start, "2026-08-19");
    expect(next.streakDays).toBe(10);
    expect(next.streakFreezes).toBe(1);
    expect(next.lastFindDay).toBe("2026-08-19");
  });

  test("exactly one missed day with no freeze resets the streak to 1", () => {
    const start = at({ streakDays: 9, streakFreezes: 0, lastFindDay: "2026-08-17" });
    const next = applyFind(start, "2026-08-19");
    expect(next.streakDays).toBe(1);
    expect(next.streakFreezes).toBe(0);
  });

  test("a two-day gap is not coverable by a freeze — streak resets, freeze kept", () => {
    const start = at({ streakDays: 12, streakFreezes: 3, lastFindDay: "2026-08-16" });
    const next = applyFind(start, "2026-08-19");
    expect(next.streakDays).toBe(1);
    expect(next.streakFreezes).toBe(3);
  });

  test.each([
    [6, 7, 1],
    [29, 30, 2],
    [99, 100, 3],
  ])("streak becoming %i→%i grants %i freeze(s)", (from, to, granted) => {
    const start = at({ streakDays: from, streakFreezes: 0, lastFindDay: "2026-08-19" });
    const next = applyFind(start, "2026-08-20");
    expect(next.streakDays).toBe(to);
    expect(next.streakFreezes).toBe(granted);
  });

  test("a milestone already reached does not re-grant on a same-day find", () => {
    const start = at({ streakDays: 7, streakFreezes: 1, lastFindDay: "2026-08-19" });
    const next = applyFind(start, "2026-08-19");
    expect(next.streakDays).toBe(7);
    expect(next.streakFreezes).toBe(1);
  });

  test("a freeze-covered gap that lands on a milestone both spends and grants", () => {
    const start = at({ streakDays: 6, streakFreezes: 1, lastFindDay: "2026-08-17" });
    const next = applyFind(start, "2026-08-19");
    expect(next.streakDays).toBe(7);
    // spent one to cover the gap, earned one for hitting 7
    expect(next.streakFreezes).toBe(1);
  });

  test("a backdated find earns XP but never resets a live streak", () => {
    const start = at({ xp: 90, streakDays: 8, lastFindDay: "2026-08-19" });
    const next = applyFind(start, "2026-08-10");
    expect(next.xp).toBe(100);
    expect(next.streakDays).toBe(8);
    expect(next.lastFindDay).toBe("2026-08-19");
  });

  test("30 consecutive days produce streak 30 and the 7- and 30-day grants", () => {
    let p = defaultProgress();
    for (let i = 0; i < 30; i++) {
      const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      p = applyFind(p, day);
    }
    expect(p.streakDays).toBe(30);
    expect(p.streakFreezes).toBe(3); // 1 at day 7 + 2 at day 30
    expect(p.xp).toBe(300);
    expect(p.level).toBe(2);
    UserProgress.parse(p);
  });
});

describe("level curve", () => {
  test.each([
    [0, 1],
    [10, 1],
    [99, 1],
    [100, 2],
    [399, 2],
    [400, 3],
    [900, 4],
    [1600, 5],
  ])("xp %i → level %i", (xp, level) => {
    expect(levelForXp(xp)).toBe(level);
  });

  test("applyFind derives level from the post-award XP total", () => {
    const next = applyFind(at({ xp: 90, streakDays: 1, lastFindDay: "2026-08-19" }), "2026-08-19");
    expect(next.xp).toBe(100);
    expect(next.level).toBe(2);
  });
});

describe("day helpers", () => {
  test("utcDay pins the day boundary to UTC, not the device timezone", () => {
    expect(utcDay("2026-08-19T23:59:59.000Z")).toBe("2026-08-19");
    expect(utcDay("2026-08-20T00:00:00.000Z")).toBe("2026-08-20");
  });

  test("dayDiff counts whole days including across months", () => {
    expect(dayDiff("2026-08-19", "2026-08-19")).toBe(0);
    expect(dayDiff("2026-08-19", "2026-08-20")).toBe(1);
    expect(dayDiff("2026-08-31", "2026-09-02")).toBe(2);
    expect(dayDiff("2026-08-20", "2026-08-19")).toBe(-1);
  });
});

describe("progress-store (in-memory)", () => {
  const userId = () => `u_prog_${Math.random().toString(36).slice(2)}`;

  test("unknown user reads back the default row", async () => {
    const p = await getProgress(userId());
    expect(p).toEqual(defaultProgress());
    UserProgress.parse(p);
  });

  test("bumpProgressOnFind persists what getProgress reads back", async () => {
    const uid = userId();
    await bumpProgressOnFind(uid, "2026-08-19T12:00:00.000Z");
    const first = await getProgress(uid);
    expect(first.xp).toBe(XP_PER_FIND);
    expect(first.streakDays).toBe(1);
    expect(first.lastFindDay).toBe("2026-08-19");

    // second find, next UTC day → streak 2, xp 20
    await bumpProgressOnFind(uid, "2026-08-20T03:15:00.000Z");
    const second = await getProgress(uid);
    expect(second.xp).toBe(20);
    expect(second.streakDays).toBe(2);
    expect(second.lastFindDay).toBe("2026-08-20");
    UserProgress.parse(second);
  });

  test("multiple finds on one day stack XP without stacking the streak", async () => {
    const uid = userId();
    await bumpProgressOnFind(uid, "2026-08-19T01:00:00.000Z");
    await bumpProgressOnFind(uid, "2026-08-19T09:00:00.000Z");
    await bumpProgressOnFind(uid, "2026-08-19T22:00:00.000Z");
    const p = await getProgress(uid);
    expect(p.xp).toBe(30);
    expect(p.streakDays).toBe(1);
  });

  test("progress is isolated per user", async () => {
    const a = userId();
    const b = userId();
    await bumpProgressOnFind(a, "2026-08-19T12:00:00.000Z");
    expect((await getProgress(a)).xp).toBe(10);
    expect((await getProgress(b)).xp).toBe(0);
  });

  test("the default row carries an empty badges array", async () => {
    expect((await getProgress(userId())).badges).toEqual([]);
  });

  test("a find preserves badges already earned", () => {
    const next = applyFind(
      at({ badges: ["sector:Energy"], lastFindDay: "2026-08-19" }),
      "2026-08-20",
    );
    expect(next.badges).toEqual(["sector:Energy"]);
  });
});

describe("applyXpGrant (pure grant rule)", () => {
  test("adds XP and re-derives the level", () => {
    const next = applyXpGrant(at({ xp: 80, level: 1 }), 25);
    expect(next.xp).toBe(105);
    expect(next.level).toBe(2);
    UserProgress.parse(next);
  });

  test("appends a badge once and leaves the array alone on a repeat", () => {
    const first = applyXpGrant(defaultProgress(), 50, "sector:Energy");
    expect(first.badges).toEqual(["sector:Energy"]);
    const second = applyXpGrant(first, 50, "sector:Energy");
    expect(second.badges).toEqual(["sector:Energy"]);
  });

  test("never subtracts XP", () => {
    expect(applyXpGrant(at({ xp: 30 }), -100).xp).toBe(30);
  });

  test("leaves streak state untouched", () => {
    const next = applyXpGrant(
      at({ streakDays: 9, streakFreezes: 2, lastFindDay: "2026-08-19" }),
      10,
    );
    expect(next.streakDays).toBe(9);
    expect(next.streakFreezes).toBe(2);
    expect(next.lastFindDay).toBe("2026-08-19");
  });
});

describe("awardXp / awardBadge idempotency (in-memory)", () => {
  const userId = () => `u_grant_${Math.random().toString(36).slice(2)}`;

  test("the first grant for a key returns true and adds XP; repeats are no-ops", async () => {
    const uid = userId();
    expect(await awardXp(uid, 25, "quest:2026-08-20:new_tile")).toBe(true);
    expect((await getProgress(uid)).xp).toBe(25);

    expect(await awardXp(uid, 25, "quest:2026-08-20:new_tile")).toBe(false);
    expect(await awardXp(uid, 25, "quest:2026-08-20:new_tile")).toBe(false);
    expect((await getProgress(uid)).xp).toBe(25);
  });

  test("distinct grant keys stack, and the level follows the total", async () => {
    const uid = userId();
    await awardXp(uid, 10, "quest:2026-08-20:catch_any");
    await awardXp(uid, 20, "quest:2026-08-20:catch_private");
    await awardXp(uid, 25, "quest:2026-08-21:catch_any");
    const p = await getProgress(uid);
    expect(p.xp).toBe(55);
    expect(p.level).toBe(levelForXp(55));
    UserProgress.parse(p);
  });

  test("grants are isolated per user", async () => {
    const a = userId();
    const b = userId();
    expect(await awardXp(a, 10, "quest:2026-08-20:catch_any")).toBe(true);
    // Same key, different user → still a first grant.
    expect(await awardXp(b, 10, "quest:2026-08-20:catch_any")).toBe(true);
    expect((await getProgress(a)).xp).toBe(10);
    expect((await getProgress(b)).xp).toBe(10);
  });

  test("XP from finds and XP from grants accumulate on the same row", async () => {
    const uid = userId();
    await bumpProgressOnFind(uid, "2026-08-20T12:00:00.000Z");
    await awardXp(uid, 25, "quest:2026-08-20:new_tile");
    const p = await getProgress(uid);
    expect(p.xp).toBe(XP_PER_FIND + 25);
    expect(p.streakDays).toBe(1);
  });

  test("awardBadge appends the badge exactly once and grants its XP once", async () => {
    const uid = userId();
    expect(await awardBadge(uid, "sector:Consumer Staples", 50)).toBe(true);
    let p = await getProgress(uid);
    expect(p.badges).toEqual(["sector:Consumer Staples"]);
    expect(p.xp).toBe(50);

    expect(await awardBadge(uid, "sector:Consumer Staples", 50)).toBe(false);
    p = await getProgress(uid);
    expect(p.badges).toEqual(["sector:Consumer Staples"]);
    expect(p.xp).toBe(50);
    UserProgress.parse(p);
  });

  test("different badges accumulate in earn order", async () => {
    const uid = userId();
    await awardBadge(uid, "sector:Energy", 50);
    await awardBadge(uid, "sector:Utilities", 50);
    const p = await getProgress(uid);
    expect(p.badges).toEqual(["sector:Energy", "sector:Utilities"]);
    expect(p.xp).toBe(100);
  });

  test("a badge and a raw grant share the ledger without colliding", async () => {
    const uid = userId();
    // awardBadge claims "badge:sector:Energy"; the bare name is a different key.
    expect(await awardBadge(uid, "sector:Energy", 50)).toBe(true);
    expect(await awardXp(uid, 5, "sector:Energy")).toBe(true);
    // …and re-offering the badge's own key is declined.
    expect(await awardXp(uid, 50, "badge:sector:Energy")).toBe(false);
    const p = await getProgress(uid);
    expect(p.xp).toBe(55);
    expect(p.badges).toEqual(["sector:Energy"]);
  });

  test("badges survive a later find bump", async () => {
    const uid = userId();
    await awardBadge(uid, "sector:Energy", 50);
    await bumpProgressOnFind(uid, "2026-08-20T12:00:00.000Z");
    const p = await getProgress(uid);
    expect(p.badges).toEqual(["sector:Energy"]);
    expect(p.xp).toBe(50 + XP_PER_FIND);
  });
});
