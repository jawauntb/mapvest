import { describe, expect, test } from "bun:test";
import {
  tileUncoverDedupeSlot,
  tileUncoverPushBody,
  tileUncoverPushTitle,
} from "./rivalryNotifier.js";

/**
 * Co-op tile uncover's push copy (this file's RETARGETED trigger — see the
 * file-level docstring). Pure functions only; `notifyTileUncovered` itself
 * needs `push-tokens-store`/`push-dispatcher` wiring and is exercised
 * end-to-end via `tile-progress-store.test.ts`'s reward-split tests instead.
 */
describe("tileUncoverDedupeSlot", () => {
  test("is per-tile, so one tile's dedupe key never collides with another's", () => {
    expect(tileUncoverDedupeSlot("dr5reg")).toBe("tile_uncover:dr5reg");
    expect(tileUncoverDedupeSlot("dr5reg")).not.toBe(tileUncoverDedupeSlot("9q8yyk"));
  });
});

describe("tile-uncover push copy", () => {
  const ADVICE = /\b(buy|sell|should|hold|invest|position|target price|recommend)\b/i;

  test("reports the raid and this recipient's own share, in collection framing", () => {
    expect(tileUncoverPushTitle()).toBe("Tile uncovered");
    expect(tileUncoverPushBody({ contributorsCount: 5, xp: 20 })).toBe(
      "5 Finders captured together this week and uncovered the tile — you earned +20 XP.",
    );
  });

  test("a remainder share still reads correctly in copy", () => {
    expect(tileUncoverPushBody({ contributorsCount: 5, xp: 10 })).toBe(
      "5 Finders captured together this week and uncovered the tile — you earned +10 XP.",
    );
  });

  test("never uses advice language", () => {
    const body = tileUncoverPushBody({ contributorsCount: 5, xp: 22 });
    expect(body).not.toMatch(ADVICE);
    expect(tileUncoverPushTitle()).not.toMatch(ADVICE);
  });
});
