import { describe, expect, test } from "bun:test";
import type { Find } from "@mapvest/core";
import {
  EVOLUTION_TIERS,
  effectiveTicker,
  eligibleFinds,
  evolutionBody,
  evolutionDedupeKey,
  highestTierRecorded,
  pctSinceFound,
  tierForChange,
} from "../src/lib/notifiers/findEvolutionNotifier.js";

/**
 * Offline-only (no POSTGRES_URL, no network). Exercises the pure surface of
 * the find-evolution notifier: tier boundaries, dedupe-key formatting,
 * eligibility filtering and the collection-framed copy. `getQuote` is never
 * called from here — the scan itself is scheduler-driven and network-bound.
 */

function find(over: Partial<Find> = {}): Find {
  return {
    id: "f_1",
    brand: "Chipotle",
    ticker: "CMG",
    isPublic: true,
    confidence: "high",
    foundPrice: 100,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("tierForChange", () => {
  test("below +10% is not an evolution", () => {
    expect(tierForChange(9.99)).toBeNull();
    expect(tierForChange(0)).toBeNull();
    expect(tierForChange(9.999999)).toBeNull();
  });

  test("negative changes never evolve", () => {
    expect(tierForChange(-1)).toBeNull();
    expect(tierForChange(-26)).toBeNull();
    expect(tierForChange(-100)).toBeNull();
  });

  test("returns the highest tier crossed", () => {
    expect(tierForChange(10)).toBe(10);
    expect(tierForChange(24.99)).toBe(10);
    expect(tierForChange(25)).toBe(25);
    expect(tierForChange(26)).toBe(25);
    expect(tierForChange(49.9)).toBe(25);
    expect(tierForChange(50)).toBe(50);
    expect(tierForChange(99.9)).toBe(50);
    expect(tierForChange(100)).toBe(100);
    expect(tierForChange(101)).toBe(100);
    expect(tierForChange(1_000)).toBe(100);
  });

  test("every tier boundary is exactly inclusive", () => {
    for (const tier of EVOLUTION_TIERS) {
      expect(tierForChange(tier)).toBe(tier);
      expect(tierForChange(tier - 0.01)).not.toBe(tier);
    }
  });

  test("non-finite input yields null", () => {
    expect(tierForChange(Number.NaN)).toBeNull();
    expect(tierForChange(Number.POSITIVE_INFINITY)).toBeNull();
    expect(tierForChange(Number.NEGATIVE_INFINITY)).toBeNull();
  });
});

describe("pctSinceFound", () => {
  test("computes change against the found price", () => {
    expect(pctSinceFound(100, 126)).toBeCloseTo(26, 10);
    expect(pctSinceFound(50, 100)).toBeCloseTo(100, 10);
    expect(pctSinceFound(100, 90)).toBeCloseTo(-10, 10);
  });

  test("refuses to invent a basis", () => {
    expect(pctSinceFound(0, 100)).toBeNull();
    expect(pctSinceFound(-5, 100)).toBeNull();
    expect(pctSinceFound(Number.NaN, 100)).toBeNull();
    expect(pctSinceFound(100, Number.NaN)).toBeNull();
  });
});

describe("evolutionDedupeKey", () => {
  test("formats as evo:{findId} — one durable slot per find", () => {
    expect(evolutionDedupeKey("f_abc")).toBe("evo:f_abc");
  });

  test("is unique per find", () => {
    expect(evolutionDedupeKey("f_1")).not.toBe(evolutionDedupeKey("f_2"));
  });
});

describe("highestTierRecorded (monotonic dedupe)", () => {
  const tokensWith = (value?: string) => [
    { prefs: value === undefined ? {} : { last_sent: { "evo:f_1": value } } },
  ];

  test("0 when nothing was ever sent", () => {
    expect(highestTierRecorded(tokensWith(undefined), "evo:f_1")).toBe(0);
  });

  test("returns the stored tier, so equal or lower tiers are blocked", () => {
    const tokens = tokensWith("25");
    const stored = highestTierRecorded(tokens, "evo:f_1");
    expect(stored).toBe(25);
    // Re-crossing 10 or 25 after a drawdown must not fire; 50 must.
    expect(10 <= stored).toBe(true);
    expect(25 <= stored).toBe(true);
    expect(50 <= stored).toBe(false);
  });

  test("takes the max across multiple tokens and ignores garbage values", () => {
    const tokens = [
      { prefs: { last_sent: { "evo:f_1": "10" } } },
      { prefs: { last_sent: { "evo:f_1": "50" } } },
      { prefs: { last_sent: { "evo:f_1": "sent" } } },
    ];
    expect(highestTierRecorded(tokens, "evo:f_1")).toBe(50);
  });

  test("other slots do not leak in", () => {
    const tokens = [{ prefs: { last_sent: { "evo:f_2": "100" } } }];
    expect(highestTierRecorded(tokens, "evo:f_1")).toBe(0);
  });
});

describe("effectiveTicker", () => {
  test("prefers the find's own ticker", () => {
    expect(effectiveTicker({ ticker: "CMG", comparable: "SBUX" })).toBe("CMG");
  });

  test("falls back to the private→public comparable", () => {
    expect(effectiveTicker({ ticker: undefined, comparable: "sbux" })).toBe("SBUX");
  });

  test("null when neither is present", () => {
    expect(effectiveTicker({ ticker: undefined, comparable: undefined })).toBeNull();
    expect(effectiveTicker({ ticker: "  ", comparable: "" })).toBeNull();
  });
});

describe("eligibleFinds", () => {
  test("keeps finds with a positive found price and an effective ticker", () => {
    const rows = eligibleFinds([
      find({ id: "keep_public" }),
      find({ id: "keep_comparable", ticker: undefined, comparable: "SBUX" }),
      find({ id: "drop_no_price", foundPrice: undefined }),
      find({ id: "drop_zero_price", foundPrice: 0 }),
      find({ id: "drop_no_ticker", ticker: undefined, comparable: undefined }),
    ]);
    expect(rows.map((r) => r.find.id)).toEqual(["keep_public", "keep_comparable"]);
    expect(rows.map((r) => r.ticker)).toEqual(["CMG", "SBUX"]);
  });
});

describe("evolution push copy", () => {
  const BANNED = /\b(buy|sell|sold|should|hold|invest in|price target|recommend)\b/i;

  test("is a collection event, never advice", () => {
    expect(evolutionBody("Chipotle", 26.4)).toBe("Chipotle evolved — up 26% since you found it");
    for (const pct of [10, 25.5, 50.4, 137.9]) {
      expect(BANNED.test(evolutionBody("Chipotle", pct))).toBe(false);
    }
  });

  test("rounds the change to a whole percent", () => {
    expect(evolutionBody("Nintendo", 10.4)).toContain("up 10%");
    expect(evolutionBody("Nintendo", 99.6)).toContain("up 100%");
  });

  test("names the brand and anchors to the find", () => {
    const body = evolutionBody("Blue Bottle", 52);
    expect(body.startsWith("Blue Bottle evolved")).toBe(true);
    expect(body.endsWith("since you found it")).toBe(true);
  });
});
