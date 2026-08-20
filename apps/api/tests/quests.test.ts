import { describe, expect, test } from "bun:test";
import { Quest, QuestsResponse } from "@mapvest/core";
import type { DexSeed } from "../src/lib/dex.js";
import {
  MAX_QUESTS_PER_DAY,
  MIN_QUESTS_PER_DAY,
  QUEST_CATALOG,
  completionFor,
  dayQuests,
  hashString,
  isPrivateFind,
  questId,
  splitFindsByDay,
} from "../src/lib/quests.js";

/**
 * Pure-function tests — no network, no POSTGRES_URL, no store. The generator
 * must be deterministic (no Math.random anywhere in the module) and the
 * checker must decide completion from the find stream alone.
 */

const SEED: DexSeed = {
  "mcdonald's": { ticker: "MCD", sector: "Consumer Discretionary" },
  mcdonalds: { ticker: "MCD", sector: "Consumer Discretionary" },
  starbucks: { ticker: "SBUX", sector: "Consumer Discretionary" },
  "coca-cola": { ticker: "KO", sector: "Consumer Staples" },
  pepsi: { ticker: "PEP", sector: "Consumer Staples" },
  apple: { ticker: "AAPL", sector: "Information Technology" },
};

let seq = 0;
function find(over: Partial<import("@mapvest/core").Find> = {}) {
  seq += 1;
  return {
    id: `f_${seq}`,
    brand: `Brand ${seq}`,
    confidence: "high" as const,
    createdAt: "2026-08-20T12:00:00.000Z",
    ...over,
  };
}

/** Today's quest board for a user, with every catalog kind present. */
function allKinds(dayUtc: string): Quest[] {
  return QUEST_CATALOG.map((def) => ({
    id: questId(dayUtc, def.kind),
    kind: def.kind,
    title: def.title,
    xp: def.xp,
    completed: false,
    progress: 0,
    target: def.target,
  }));
}

function byKind(quests: Quest[], kind: Quest["kind"]): Quest {
  const q = quests.find((x) => x.kind === kind);
  if (!q) throw new Error(`missing quest ${kind}`);
  return q;
}

describe("hashString", () => {
  test("is stable for the same input and differs across inputs", () => {
    expect(hashString("u_1|2026-08-20")).toBe(hashString("u_1|2026-08-20"));
    expect(hashString("u_1|2026-08-20")).not.toBe(hashString("u_1|2026-08-21"));
    expect(hashString("u_1|2026-08-20")).not.toBe(hashString("u_2|2026-08-20"));
  });

  test("stays a non-negative 32-bit integer", () => {
    for (const s of ["", "a", "u_zzz|2026-12-31", "🙂 unicode"]) {
      const h = hashString(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("dayQuests (deterministic generation)", () => {
  test("same user + same day yields exactly the same quests", () => {
    const a = dayQuests("u_alice", "2026-08-20");
    const b = dayQuests("u_alice", "2026-08-20");
    expect(b).toEqual(a);
    // Repeat many times: a Math.random-based generator would drift.
    for (let i = 0; i < 25; i++) {
      expect(dayQuests("u_alice", "2026-08-20")).toEqual(a);
    }
  });

  test("quests are unstarted and schema-valid, with catalog xp/target", () => {
    const quests = dayQuests("u_alice", "2026-08-20");
    for (const q of quests) {
      expect(Quest.parse(q)).toEqual(q);
      expect(q.completed).toBe(false);
      expect(q.progress).toBe(0);
      expect(q.id).toBe(`2026-08-20:${q.kind}`);
      const def = QUEST_CATALOG.find((d) => d.kind === q.kind);
      expect(q.xp).toBe(def?.xp);
      expect(q.target).toBe(def?.target);
      expect(q.title.length).toBeGreaterThan(0);
    }
  });

  test("always 2-3 quests, all distinct kinds, in catalog order", () => {
    const order = QUEST_CATALOG.map((d) => d.kind);
    for (let i = 0; i < 200; i++) {
      const quests = dayQuests(`u_${i}`, "2026-08-20");
      expect(quests.length).toBeGreaterThanOrEqual(MIN_QUESTS_PER_DAY);
      expect(quests.length).toBeLessThanOrEqual(MAX_QUESTS_PER_DAY);
      expect(new Set(quests.map((q) => q.kind)).size).toBe(quests.length);
      const positions = quests.map((q) => order.indexOf(q.kind));
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });

  test("a different day can produce a different set for the same user", () => {
    const day0 = dayQuests("u_alice", "2026-08-20");
    const sets = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const day = new Date(Date.UTC(2026, 7, 20 + i)).toISOString().slice(0, 10);
      sets.add(
        dayQuests("u_alice", day)
          .map((q) => q.kind)
          .join(","),
      );
    }
    expect(sets.size).toBeGreaterThan(1);
    expect(sets.has(day0.map((q) => q.kind).join(","))).toBe(true);
  });

  test("different users on the same day can get different sets", () => {
    const sets = new Set<string>();
    for (let i = 0; i < 50; i++) {
      sets.add(
        dayQuests(`u_${i}`, "2026-08-20")
          .map((q) => q.kind)
          .join(","),
      );
    }
    expect(sets.size).toBeGreaterThan(1);
  });

  test("every catalog kind is reachable across the user space", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      for (const q of dayQuests(`u_${i}`, "2026-08-20")) seen.add(q.kind);
    }
    expect([...seen].sort()).toEqual(QUEST_CATALOG.map((d) => d.kind).sort());
  });

  test("ids are unique within a day and namespaced by day", () => {
    const quests = dayQuests("u_alice", "2026-08-20");
    expect(new Set(quests.map((q) => q.id)).size).toBe(quests.length);
    expect(dayQuests("u_alice", "2026-08-21").every((q) => q.id.startsWith("2026-08-21:"))).toBe(
      true,
    );
  });
});

describe("isPrivateFind", () => {
  test("explicit isPublic:false is private", () => {
    expect(isPrivateFind(find({ isPublic: false, comparable: "SBUX" }))).toBe(true);
  });

  test("a comparable with no direct ticker is private", () => {
    expect(isPrivateFind(find({ comparable: "SBUX" }))).toBe(true);
  });

  test("a listed ticker is not private", () => {
    expect(isPrivateFind(find({ ticker: "MCD", isPublic: true }))).toBe(false);
    expect(isPrivateFind(find({ ticker: "MCD" }))).toBe(false);
  });

  test("an unresolved find with neither ticker nor comparable is not private", () => {
    expect(isPrivateFind(find({}))).toBe(false);
  });
});

describe("completionFor — catch_any", () => {
  const quests = allKinds("2026-08-20");

  test("no finds today → 0/1, incomplete", () => {
    const out = byKind(completionFor(quests, [], [find({ ticker: "MCD" })], SEED), "catch_any");
    expect(out.progress).toBe(0);
    expect(out.completed).toBe(false);
  });

  test("one find today completes it", () => {
    const out = byKind(completionFor(quests, [find({ ticker: "MCD" })], [], SEED), "catch_any");
    expect(out.progress).toBe(1);
    expect(out.completed).toBe(true);
  });

  test("progress is clamped to the target", () => {
    const out = byKind(
      completionFor(quests, [find({ ticker: "MCD" }), find({ ticker: "KO" })], [], SEED),
      "catch_any",
    );
    expect(out.progress).toBe(1);
    expect(out.completed).toBe(true);
  });
});

describe("completionFor — catch_private", () => {
  const quests = allKinds("2026-08-20");

  test("only a private catch counts", () => {
    const publicOnly = byKind(
      completionFor(quests, [find({ ticker: "MCD", isPublic: true })], [], SEED),
      "catch_private",
    );
    expect(publicOnly.completed).toBe(false);

    const withPrivate = byKind(
      completionFor(
        quests,
        [find({ ticker: "MCD", isPublic: true }), find({ isPublic: false, comparable: "SBUX" })],
        [],
        SEED,
      ),
      "catch_private",
    );
    expect(withPrivate.progress).toBe(1);
    expect(withPrivate.completed).toBe(true);
  });

  test("a private catch on a prior day does not complete today", () => {
    const out = byKind(
      completionFor(quests, [], [find({ isPublic: false, comparable: "SBUX" })], SEED),
      "catch_private",
    );
    expect(out.completed).toBe(false);
  });
});

describe("completionFor — new_tile", () => {
  const quests = allKinds("2026-08-20");
  const SF = { lat: 37.7749, lng: -122.4194 };
  const NYC = { lat: 40.7128, lng: -74.006 };

  test("a find in a tile never caught in before completes it", () => {
    const out = byKind(
      completionFor(
        quests,
        [find({ ticker: "MCD", ...NYC })],
        [find({ ticker: "KO", ...SF })],
        SEED,
      ),
      "new_tile",
    );
    expect(out.progress).toBe(1);
    expect(out.completed).toBe(true);
  });

  test("a find back in an already-visited tile does not", () => {
    const out = byKind(
      completionFor(
        quests,
        [find({ ticker: "MCD", ...SF })],
        [find({ ticker: "KO", ...SF })],
        SEED,
      ),
      "new_tile",
    );
    expect(out.progress).toBe(0);
    expect(out.completed).toBe(false);
  });

  test("the first-ever find is in a new tile by definition", () => {
    const out = byKind(
      completionFor(quests, [find({ ticker: "MCD", ...SF })], [], SEED),
      "new_tile",
    );
    expect(out.completed).toBe(true);
  });

  test("finds without coordinates cannot complete it", () => {
    const out = byKind(completionFor(quests, [find({ ticker: "MCD" })], [], SEED), "new_tile");
    expect(out.progress).toBe(0);
    expect(out.completed).toBe(false);
  });

  test("two catches on the same new block count as one tile", () => {
    const out = byKind(
      completionFor(
        quests,
        [find({ ticker: "MCD", ...NYC }), find({ ticker: "KO", ...NYC })],
        [find({ ticker: "PEP", ...SF })],
        SEED,
      ),
      "new_tile",
    );
    expect(out.progress).toBe(1);
  });
});

describe("completionFor — new_sector", () => {
  const quests = allKinds("2026-08-20");

  test("a catch in a sector with no prior finds completes it", () => {
    const out = byKind(
      completionFor(
        quests,
        [find({ ticker: "AAPL" })], // Information Technology
        [find({ ticker: "MCD" })], // Consumer Discretionary
        SEED,
      ),
      "new_sector",
    );
    expect(out.progress).toBe(1);
    expect(out.completed).toBe(true);
  });

  test("a catch in a sector already represented does not", () => {
    const out = byKind(
      completionFor(quests, [find({ ticker: "SBUX" })], [find({ ticker: "MCD" })], SEED),
      "new_sector",
    );
    expect(out.completed).toBe(false);
  });

  test("a private catch resolves its sector through the comparable", () => {
    const out = byKind(
      completionFor(
        quests,
        [find({ isPublic: false, comparable: "KO" })], // Consumer Staples
        [find({ ticker: "MCD" })],
        SEED,
      ),
      "new_sector",
    );
    expect(out.completed).toBe(true);
  });

  test("a find outside the seed has no sector and cannot complete it", () => {
    const out = byKind(
      completionFor(quests, [find({ ticker: "ZZZZ" }), find({})], [], SEED),
      "new_sector",
    );
    expect(out.progress).toBe(0);
    expect(out.completed).toBe(false);
  });
});

describe("completionFor — shape", () => {
  test("returns one quest per input, preserving id/kind/xp/target", () => {
    const quests = dayQuests("u_alice", "2026-08-20");
    const out = completionFor(quests, [find({ ticker: "MCD" })], [], SEED);
    expect(out.length).toBe(quests.length);
    expect(out.map((q) => q.id)).toEqual(quests.map((q) => q.id));
    expect(out.map((q) => q.xp)).toEqual(quests.map((q) => q.xp));
    for (const q of out) expect(Quest.parse(q)).toEqual(q);
  });

  test("does not mutate the quests it was given", () => {
    const quests = allKinds("2026-08-20");
    completionFor(quests, [find({ ticker: "MCD" })], [], SEED);
    expect(quests.every((q) => q.completed === false && q.progress === 0)).toBe(true);
  });

  test("an empty journal completes nothing", () => {
    const out = completionFor(allKinds("2026-08-20"), [], [], SEED);
    expect(out.every((q) => !q.completed && q.progress === 0)).toBe(true);
  });

  test("builds a schema-valid QuestsResponse with xpGrantedToday summed", () => {
    const day = "2026-08-20";
    const quests = completionFor(
      allKinds(day),
      [find({ isPublic: false, comparable: "KO", lat: 40.7128, lng: -74.006 })],
      [],
      SEED,
    );
    // catch_any + catch_private + new_tile + new_sector all complete.
    expect(quests.every((q) => q.completed)).toBe(true);
    const xpGrantedToday = quests.filter((q) => q.completed).reduce((n, q) => n + q.xp, 0);
    const resp = { quests, day, xpGrantedToday };
    expect(QuestsResponse.parse(resp)).toEqual(resp);
    expect(xpGrantedToday).toBe(QUEST_CATALOG.reduce((n, d) => n + d.xp, 0));
  });
});

describe("splitFindsByDay", () => {
  const day = "2026-08-20";

  test("splits on the UTC day boundary, not the device timezone", () => {
    const { today, prior } = splitFindsByDay(
      [
        find({ brand: "late today", createdAt: "2026-08-20T23:59:59.000Z" }),
        find({ brand: "early today", createdAt: "2026-08-20T00:00:00.000Z" }),
        find({ brand: "yesterday", createdAt: "2026-08-19T23:59:59.000Z" }),
        find({ brand: "last month", createdAt: "2026-07-01T09:00:00.000Z" }),
      ],
      day,
    );
    expect(today.map((f) => f.brand)).toEqual(["late today", "early today"]);
    expect(prior.map((f) => f.brand)).toEqual(["yesterday", "last month"]);
  });

  test("future-dated finds land in neither bucket", () => {
    const { today, prior } = splitFindsByDay(
      [find({ brand: "tomorrow", createdAt: "2026-08-21T01:00:00.000Z" })],
      day,
    );
    expect(today).toEqual([]);
    expect(prior).toEqual([]);
  });

  test("empty in, empty out", () => {
    expect(splitFindsByDay([], day)).toEqual({ today: [], prior: [] });
  });

  test("feeds completionFor end to end: yesterday's tile is not new today", () => {
    const SF = { lat: 37.7749, lng: -122.4194 };
    const { today, prior } = splitFindsByDay(
      [
        find({ ticker: "MCD", createdAt: "2026-08-20T10:00:00.000Z", ...SF }),
        find({ ticker: "KO", createdAt: "2026-08-19T10:00:00.000Z", ...SF }),
      ],
      day,
    );
    const out = completionFor(allKinds(day), today, prior, SEED);
    expect(byKind(out, "catch_any").completed).toBe(true);
    expect(byKind(out, "new_tile").completed).toBe(false);
    // MCD is Consumer Discretionary; yesterday's KO was Consumer Staples.
    expect(byKind(out, "new_sector").completed).toBe(true);
  });
});
