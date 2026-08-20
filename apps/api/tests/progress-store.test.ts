import { describe, expect, test } from "bun:test";
import { UserProgress } from "@mapvest/core";
import {
  XP_PER_FIND,
  applyFind,
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
});
