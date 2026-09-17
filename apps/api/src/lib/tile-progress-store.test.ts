import { beforeEach, describe, expect, test } from "bun:test";
import { __resetProgressStore, getProgress } from "./progress-store.js";
import { TILE_UNCOVER_THRESHOLD, TILE_UNCOVER_XP_POOL } from "./territory.js";
import {
  __resetTileProgressStore,
  getTileProgress,
  recordTileCapture,
  tileUncoverGrantKey,
} from "./tile-progress-store.js";
import { cycleWindow } from "./weeklyCycle.js";

const TILE = "dr5reg"; // arbitrary, stable geohash-6
const OTHER_TILE = "9q8yyk";
const NOW = new Date("2026-09-16T12:00:00.000Z"); // a Wednesday, well inside its cycle

function at(offsetMinutes: number): Date {
  return new Date(NOW.getTime() + offsetMinutes * 60_000);
}

beforeEach(() => {
  __resetTileProgressStore();
  __resetProgressStore();
});

describe("recordTileCapture", () => {
  test("counts distinct Finders, not captures — a recatch by the same user is a no-op", async () => {
    await recordTileCapture("u1", TILE, at(0));
    const again = await recordTileCapture("u1", TILE, at(1));
    expect(again.contributors).toBe(1);
    expect(again.uncovered).toBe(false);
  });

  test("flips exactly at the threshold, and exactly once per cycle per tile", async () => {
    const outcomes = [];
    for (let i = 0; i < TILE_UNCOVER_THRESHOLD; i++) {
      outcomes.push(await recordTileCapture(`u${i}`, TILE, at(i)));
    }
    expect(outcomes.map((o) => o.contributors)).toEqual([1, 2, 3, 4, 5]);
    expect(outcomes.map((o) => o.uncovered)).toEqual([false, false, false, false, true]);
    expect(outcomes.map((o) => o.justUncovered)).toEqual([false, false, false, false, true]);

    // A capture after the threshold does not re-trigger or re-split: the
    // tile stays uncovered, `justUncovered` is false, and the late arrival
    // never joins the already-closed contributor set.
    const late = await recordTileCapture("late-arrival", TILE, at(100));
    expect(late.uncovered).toBe(true);
    expect(late.justUncovered).toBe(false);
    expect(late.contributors).toBe(TILE_UNCOVER_THRESHOLD);
  });

  test("a different tile keeps its own independent counter", async () => {
    for (let i = 0; i < TILE_UNCOVER_THRESHOLD; i++) {
      await recordTileCapture(`u${i}`, TILE, at(i));
    }
    const other = await recordTileCapture("u0", OTHER_TILE, at(0));
    expect(other.uncovered).toBe(false);
    expect(other.contributors).toBe(1);
  });

  test("a different weekly cycle is a fresh counter — progress resets at the shared boundary", async () => {
    for (let i = 0; i < TILE_UNCOVER_THRESHOLD; i++) {
      await recordTileCapture(`u${i}`, TILE, at(i));
    }
    const nextCycle = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000);
    const outcome = await recordTileCapture("u0", TILE, nextCycle);
    expect(outcome.cycleStart).not.toBe(cycleWindow(NOW).cycleStart.toISOString());
    expect(outcome.uncovered).toBe(false);
    expect(outcome.contributors).toBe(1);
  });

  test("getTileProgress is visible to anyone viewing the tile, not just contributors", async () => {
    const cycleStart = cycleWindow(at(0)).cycleStart.toISOString();
    const before = await getTileProgress(TILE, cycleStart);
    expect(before).toEqual({
      tile: TILE,
      cycleStart,
      contributors: 0,
      threshold: TILE_UNCOVER_THRESHOLD,
      uncovered: false,
    });

    await recordTileCapture("contributor", TILE, at(0));
    const mid = await getTileProgress(TILE, cycleStart);
    expect(mid.contributors).toBe(1);
    expect(mid.uncovered).toBe(false);
  });
});

describe("reward split exactness (no XP lost to rounding)", () => {
  test("the XP paid out across every contributor sums to exactly the pool", async () => {
    const users = Array.from({ length: TILE_UNCOVER_THRESHOLD }, (_, i) => `payee-${i}`);
    for (const [i, userId] of users.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await recordTileCapture(userId, TILE, at(i));
    }
    let total = 0;
    for (const userId of users) {
      // eslint-disable-next-line no-await-in-loop
      const progress = await getProgress(userId);
      total += progress.xp;
    }
    expect(total).toBe(TILE_UNCOVER_XP_POOL);
  });

  test("the grant key is scoped to tile, cycle AND contributor — never double-payable", async () => {
    const cycleStart = cycleWindow(at(0)).cycleStart.toISOString();
    expect(tileUncoverGrantKey(TILE, cycleStart, "u0")).toBe(
      `tile_uncover:${TILE}:${cycleStart}:u0`,
    );
    expect(tileUncoverGrantKey(TILE, cycleStart, "u0")).not.toBe(
      tileUncoverGrantKey(TILE, cycleStart, "u1"),
    );
    expect(tileUncoverGrantKey(OTHER_TILE, cycleStart, "u0")).not.toBe(
      tileUncoverGrantKey(TILE, cycleStart, "u0"),
    );
  });
});
