import { describe, expect, test } from "bun:test";
import { Rivalry } from "@mapvest/core";
import {
  DRAW_THRESHOLD_PP,
  RIVALRY_PICK_XP,
  decideOutcome,
  pickWasCorrect,
  rivalryDedupeSlot,
  rivalryGrantKey,
  rivalryPushBody,
  rivalryPushTitle,
  weeklyChangePct,
} from "../src/lib/notifiers/rivalryNotifier.js";
import {
  MAX_RIVALRIES_PER_USER,
  createRivalry,
  deleteRivalry,
  getRivalry,
  listAllRivalries,
  listRivalries,
  mondayUtc,
  recordResult,
  setPick,
} from "../src/lib/rivalries-store.js";

/**
 * Offline only — POSTGRES_URL is unset in the test env, so every store call
 * takes the in-memory path, and nothing here touches the network: the weekly
 * scoring, dedupe-key and grant-key rules are exercised as pure functions.
 */

const userId = () => `u_riv_${Math.random().toString(36).slice(2)}`;

/** Ascending close series ending at `closes.at(-1)`. */
function series(closes: number[]): Array<{ ts: number; close: number }> {
  return closes.map((close, i) => ({ ts: 1_700_000_000_000 + i * 86_400_000, close }));
}

describe("rivalries-store (in-memory)", () => {
  test("createRivalry stores an uppercase, schema-valid matchup at this week's Monday", async () => {
    const uid = userId();
    const created = await createRivalry(
      uid,
      { ticker: "nvda", rivalTicker: " amd " },
      new Date("2026-08-20T12:00:00.000Z"), // a Thursday
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("expected create to succeed");

    const parsed = Rivalry.parse(created.rivalry);
    expect(parsed.ticker).toBe("NVDA");
    expect(parsed.rivalTicker).toBe("AMD");
    expect(parsed.wins).toBe(0);
    expect(parsed.losses).toBe(0);
    expect(parsed.draws).toBe(0);
    expect(parsed.currentPick).toBeUndefined();
    expect(parsed.weekStart).toBe("2026-08-17"); // the Monday of that week
  });

  test("the (user, ticker, rivalTicker) pair is unique; the duplicate returns the original", async () => {
    const uid = userId();
    const first = await createRivalry(uid, { ticker: "KO", rivalTicker: "PEP" });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected create to succeed");

    const dupe = await createRivalry(uid, { ticker: "ko", rivalTicker: "pep" });
    expect(dupe.ok).toBe(false);
    if (dupe.ok) throw new Error("expected duplicate rejection");
    expect(dupe.reason).toBe("duplicate");
    expect(dupe.rivalry?.id).toBe(first.rivalry.id);

    // Same pair for a different user is a different rivalry.
    const other = await createRivalry(userId(), { ticker: "KO", rivalTicker: "PEP" });
    expect(other.ok).toBe(true);

    // Reversing the pair is a distinct matchup.
    const reversed = await createRivalry(uid, { ticker: "PEP", rivalTicker: "KO" });
    expect(reversed.ok).toBe(true);
    expect((await listRivalries(uid)).length).toBe(2);
  });

  test("a ticker cannot be its own rival", async () => {
    const res = await createRivalry(userId(), { ticker: "AAPL", rivalTicker: "aapl" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected same_ticker rejection");
    expect(res.reason).toBe("same_ticker");
  });

  test(`caps a user at ${MAX_RIVALRIES_PER_USER} rivalries`, async () => {
    const uid = userId();
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let i = 0; i < MAX_RIVALRIES_PER_USER; i++) {
      const res = await createRivalry(uid, { ticker: `AA${alphabet[i]}`, rivalTicker: "SPY" });
      expect(res.ok).toBe(true);
    }
    const overflow = await createRivalry(uid, { ticker: "ZZZ", rivalTicker: "SPY" });
    expect(overflow.ok).toBe(false);
    if (overflow.ok) throw new Error("expected cap rejection");
    expect(overflow.reason).toBe("cap");
    expect((await listRivalries(uid)).length).toBe(MAX_RIVALRIES_PER_USER);
  });

  test("listRivalries is newest-first and scoped to the owner", async () => {
    const uid = userId();
    const t0 = new Date("2026-08-17T09:00:00.000Z");
    await createRivalry(uid, { ticker: "F", rivalTicker: "GM" }, t0);
    await createRivalry(
      uid,
      { ticker: "UBER", rivalTicker: "LYFT" },
      new Date(t0.getTime() + 1000),
    );
    await createRivalry(userId(), { ticker: "MSFT", rivalTicker: "GOOGL" }, t0);

    const mine = await listRivalries(uid);
    expect(mine.map((r) => r.ticker)).toEqual(["UBER", "F"]);
    for (const r of mine) Rivalry.parse(r);
  });

  test("setPick registers, replaces and clears the pick; foreign ids are invisible", async () => {
    const uid = userId();
    const created = await createRivalry(uid, { ticker: "SBUX", rivalTicker: "DNUT" });
    if (!created.ok) throw new Error("expected create to succeed");
    const id = created.rivalry.id;

    expect((await setPick(uid, id, "ticker"))?.currentPick).toBe("ticker");
    expect((await setPick(uid, id, "rival"))?.currentPick).toBe("rival");
    expect((await setPick(uid, id, null))?.currentPick).toBeUndefined();
    expect(await setPick(userId(), id, "ticker")).toBeNull();
    expect(await getRivalry(userId(), id)).toBeNull();
    expect((await getRivalry(uid, id))?.rivalTicker).toBe("DNUT");
  });

  test("recordResult increments the right counter, opens the next week and clears the pick", async () => {
    const uid = userId();
    const created = await createRivalry(
      uid,
      { ticker: "NKE", rivalTicker: "ADDYY" },
      new Date("2026-08-17T09:00:00.000Z"),
    );
    if (!created.ok) throw new Error("expected create to succeed");
    const id = created.rivalry.id;
    await setPick(uid, id, "ticker");

    const afterWin = await recordResult(id, "win", "2026-08-24");
    expect(afterWin?.wins).toBe(1);
    expect(afterWin?.losses).toBe(0);
    expect(afterWin?.draws).toBe(0);
    expect(afterWin?.weekStart).toBe("2026-08-24");
    expect(afterWin?.currentPick).toBeUndefined();
    expect(afterWin?.userId).toBe(uid);

    await recordResult(id, "loss", "2026-08-31");
    const afterDraw = await recordResult(id, "draw", "2026-09-07");
    expect(afterDraw?.wins).toBe(1);
    expect(afterDraw?.losses).toBe(1);
    expect(afterDraw?.draws).toBe(1);

    const [visible] = await listRivalries(uid);
    Rivalry.parse(visible);
    expect(visible?.weekStart).toBe("2026-09-07");
    expect(
      await recordResult("00000000-0000-0000-0000-000000000000", "win", "2026-09-07"),
    ).toBeNull();
  });

  test("listAllRivalries carries the owner id for the notifier fan-out; delete is owner-scoped", async () => {
    const uid = userId();
    const created = await createRivalry(uid, { ticker: "DAL", rivalTicker: "UAL" });
    if (!created.ok) throw new Error("expected create to succeed");

    const all = await listAllRivalries();
    const mine = all.find((r) => r.id === created.rivalry.id);
    expect(mine?.userId).toBe(uid);

    expect(await deleteRivalry(userId(), created.rivalry.id)).toBe(false);
    expect(await deleteRivalry(uid, created.rivalry.id)).toBe(true);
    expect(await listRivalries(uid)).toEqual([]);
  });

  test("mondayUtc anchors every day of the week to the same Monday, in UTC", () => {
    expect(mondayUtc(new Date("2026-08-17T00:00:00.000Z"))).toBe("2026-08-17"); // Mon
    expect(mondayUtc(new Date("2026-08-17T23:59:59.999Z"))).toBe("2026-08-17");
    expect(mondayUtc(new Date("2026-08-20T12:00:00.000Z"))).toBe("2026-08-17"); // Thu
    expect(mondayUtc(new Date("2026-08-23T18:00:00.000Z"))).toBe("2026-08-17"); // Sun
    expect(mondayUtc(new Date("2026-08-24T00:00:00.000Z"))).toBe("2026-08-24"); // next Mon
  });
});

describe("rivalry weekly scoring (pure)", () => {
  test("weeklyChangePct measures the last five sessions against their basis", () => {
    // 6 points: basis 100 (index 0), last 110 → +10%.
    expect(weeklyChangePct(series([100, 101, 102, 103, 104, 110]))).toBeCloseTo(10, 10);
    // A longer series still only looks back five sessions.
    expect(weeklyChangePct(series([1, 2, 3, 200, 0, 0, 0, 0, 220]))).toBeCloseTo(10, 10);
    // Short series degrade to the oldest close available rather than failing.
    expect(weeklyChangePct(series([50, 55]))).toBeCloseTo(10, 10);
  });

  test("weeklyChangePct returns null rather than inventing a basis", () => {
    expect(weeklyChangePct(null)).toBeNull();
    expect(weeklyChangePct([])).toBeNull();
    expect(weeklyChangePct(series([100]))).toBeNull();
    expect(weeklyChangePct(series([0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(weeklyChangePct(series([-10, 5]))).toBeNull();
    expect(
      weeklyChangePct([
        { ts: 1, close: Number.NaN },
        { ts: 2, close: 10 },
      ]),
    ).toBeNull();
  });

  test("the higher weekly change wins; a sub-threshold gap is a draw", () => {
    expect(decideOutcome(3.2, 1.1)).toEqual({ outcome: "win", diffPp: 3.2 - 1.1 });
    expect(decideOutcome(-4, -1)).toEqual({ outcome: "loss", diffPp: -3 });
    // Both down: losing less still wins the week.
    expect(decideOutcome(-1, -6)?.outcome).toBe("win");
    expect(decideOutcome(0.05, 0)?.outcome).toBe("draw");
    expect(decideOutcome(0, 0.05)?.outcome).toBe("draw");
    expect(decideOutcome(0, 0)?.outcome).toBe("draw");
  });

  test(`the draw band is exactly |diff| < ${DRAW_THRESHOLD_PP}pp`, () => {
    expect(decideOutcome(DRAW_THRESHOLD_PP - 0.0001, 0)?.outcome).toBe("draw");
    expect(decideOutcome(DRAW_THRESHOLD_PP, 0)?.outcome).toBe("win");
    expect(decideOutcome(-DRAW_THRESHOLD_PP, 0)?.outcome).toBe("loss");
  });

  test("non-finite inputs score nothing", () => {
    expect(decideOutcome(Number.NaN, 1)).toBeNull();
    expect(decideOutcome(1, Number.POSITIVE_INFINITY)).toBeNull();
  });

  test("a pick pays only when it called the winning side; a draw settles nothing", () => {
    expect(pickWasCorrect("ticker", "win")).toBe(true);
    expect(pickWasCorrect("ticker", "loss")).toBe(false);
    expect(pickWasCorrect("rival", "loss")).toBe(true);
    expect(pickWasCorrect("rival", "win")).toBe(false);
    expect(pickWasCorrect("ticker", "draw")).toBe(false);
    expect(pickWasCorrect("rival", "draw")).toBe(false);
    expect(pickWasCorrect(undefined, "win")).toBe(false);
  });
});

describe("rivalry dedupe + grant keys", () => {
  test("the dedupe slot is per-rivalry and the key is the week, so one round fires once", () => {
    expect(rivalryDedupeSlot("abc-123")).toBe("rivalry:abc-123");
    expect(rivalryDedupeSlot("abc-123")).not.toBe(rivalryDedupeSlot("abc-124"));
  });

  test("the XP grant key is scoped to rivalry AND week, and pays the roadmap's 30 XP", () => {
    expect(RIVALRY_PICK_XP).toBe(30);
    expect(rivalryGrantKey("abc-123", "2026-08-24")).toBe("rivalry:abc-123:2026-08-24");
    // Same rivalry, next week → a different, separately claimable grant.
    expect(rivalryGrantKey("abc-123", "2026-08-24")).not.toBe(
      rivalryGrantKey("abc-123", "2026-08-31"),
    );
    // Same week, different rivalry → also distinct.
    expect(rivalryGrantKey("abc-124", "2026-08-24")).not.toBe(
      rivalryGrantKey("abc-123", "2026-08-24"),
    );
  });
});

describe("rivalry push copy", () => {
  const ADVICE = /\b(buy|sell|should|hold|invest|position|target price|recommend)\b/i;

  test("reports the week and the running record, in collection framing", () => {
    expect(rivalryPushTitle("NVDA", "AMD")).toBe("$NVDA vs $AMD");
    expect(
      rivalryPushBody({
        ticker: "NVDA",
        rivalTicker: "AMD",
        outcome: "win",
        diffPp: 2.34,
        wins: 3,
        losses: 1,
        draws: 0,
      }),
    ).toBe("Your NVDA beat AMD by 2.3pp this week — record 3-1.");
    expect(
      rivalryPushBody({
        ticker: "NVDA",
        rivalTicker: "AMD",
        outcome: "loss",
        diffPp: -1.02,
        wins: 3,
        losses: 2,
        draws: 1,
      }),
    ).toBe("AMD beat your NVDA by 1.0pp this week — record 3-2-1.");
    expect(
      rivalryPushBody({
        ticker: "NVDA",
        rivalTicker: "AMD",
        outcome: "draw",
        diffPp: 0.02,
        wins: 3,
        losses: 2,
        draws: 2,
      }),
    ).toBe("Your NVDA and AMD finished level this week — record 3-2-2.");
  });

  test("never uses advice language", () => {
    for (const outcome of ["win", "loss", "draw"] as const) {
      const body = rivalryPushBody({
        ticker: "KO",
        rivalTicker: "PEP",
        outcome,
        diffPp: outcome === "loss" ? -4.5 : 4.5,
        wins: 1,
        losses: 1,
        draws: 1,
      });
      expect(body).not.toMatch(ADVICE);
    }
  });
});
