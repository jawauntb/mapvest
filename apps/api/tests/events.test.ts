import { describe, expect, test } from "bun:test";
import { ActiveEvent, EventsResponse, type UserProgress } from "@mapvest/core";
import {
  CANONICAL_SECTORS,
  SECTOR_SATURDAY_MULTIPLIER,
  activeEvent,
  isoWeekNumber,
  multiplierForSector,
  sectorForWeek,
} from "../src/lib/events.js";
import {
  XP_PER_FIND,
  type XpSeed,
  applyFind,
  applyFindWithMultiplier,
  defaultProgress,
  seedSectorForFind,
} from "../src/lib/progress-store.js";

/**
 * Pure-function tests — no network, no POSTGRES_URL, no store, and no
 * dependence on the wall clock: every instant is passed in explicitly.
 */

/** 2026-08-22 is a Saturday; 2026-08-21 a Friday, 2026-08-23 a Sunday. */
const SAT = new Date("2026-08-22T12:00:00.000Z");
const SAT_MIDNIGHT = new Date("2026-08-22T00:00:00.000Z");
const SAT_LAST_MS = new Date("2026-08-22T23:59:59.999Z");
const FRI = new Date("2026-08-21T23:59:59.999Z");
const SUN = new Date("2026-08-23T00:00:00.000Z");
/** The following Saturday — one ISO week later. */
const NEXT_SAT = new Date("2026-08-29T12:00:00.000Z");

const SEED: XpSeed = {
  chipotle: { ticker: "CMG", sector: "Consumer Discretionary" },
  "coca-cola": { ticker: "KO", sector: "Consumer Staples" },
  starbucks: { ticker: "SBUX", sector: "Consumer Discretionary" },
  apple: { ticker: "AAPL", sector: "tech" },
  mystery: { ticker: "MYST" },
};

describe("CANONICAL_SECTORS", () => {
  test("is the GICS sector list in a stable, self-determined order", () => {
    expect(CANONICAL_SECTORS.length).toBeGreaterThan(0);
    expect([...CANONICAL_SECTORS]).toEqual([...CANONICAL_SECTORS].sort());
    expect(CANONICAL_SECTORS).toContain("Energy");
    expect(CANONICAL_SECTORS).toContain("Information Technology");
    expect(new Set(CANONICAL_SECTORS).size).toBe(CANONICAL_SECTORS.length);
  });
});

describe("isoWeekNumber", () => {
  test("matches known ISO week boundaries", () => {
    // 2026-01-01 is a Thursday, so it is in ISO week 1 of 2026.
    expect(isoWeekNumber(new Date("2026-01-01T00:00:00.000Z"))).toBe(1);
    expect(isoWeekNumber(new Date("2026-01-04T00:00:00.000Z"))).toBe(1);
    // Monday 2026-01-05 opens week 2.
    expect(isoWeekNumber(new Date("2026-01-05T00:00:00.000Z"))).toBe(2);
  });

  test("a Saturday shares its week number with the Monday before it", () => {
    // Monday 2026-08-17 → Sunday 2026-08-23 is one ISO week.
    const monday = isoWeekNumber(new Date("2026-08-17T00:00:00.000Z"));
    expect(isoWeekNumber(SAT)).toBe(monday);
    expect(isoWeekNumber(new Date("2026-08-23T00:00:00.000Z"))).toBe(monday);
    // The next Monday opens the next week.
    expect(isoWeekNumber(new Date("2026-08-24T00:00:00.000Z"))).toBe(monday + 1);
  });

  test("is time-of-day independent", () => {
    expect(isoWeekNumber(SAT_MIDNIGHT)).toBe(isoWeekNumber(SAT_LAST_MS));
  });
});

describe("sectorForWeek", () => {
  test("walks the canonical list and wraps", () => {
    expect(sectorForWeek(1)).toBe(CANONICAL_SECTORS[0] as string);
    expect(sectorForWeek(2)).toBe(CANONICAL_SECTORS[1] as string);
    expect(sectorForWeek(1 + CANONICAL_SECTORS.length)).toBe(sectorForWeek(1));
  });

  test("is total: negative and zero week numbers still land on a real sector", () => {
    expect(CANONICAL_SECTORS).toContain(sectorForWeek(0));
    expect(CANONICAL_SECTORS).toContain(sectorForWeek(-3));
    expect(CANONICAL_SECTORS).toContain(sectorForWeek(53));
  });
});

describe("activeEvent", () => {
  test("opens only on Saturday UTC", () => {
    expect(activeEvent(FRI)).toBeNull();
    expect(activeEvent(SUN)).toBeNull();
    expect(activeEvent(SAT)).not.toBeNull();
    expect(activeEvent(SAT_MIDNIGHT)).not.toBeNull();
    expect(activeEvent(SAT_LAST_MS)).not.toBeNull();
  });

  test("is deterministic: the same week always yields the same sector", () => {
    const a = activeEvent(SAT_MIDNIGHT);
    const b = activeEvent(SAT);
    const c = activeEvent(SAT_LAST_MS);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    // And it is stable across repeated calls — no randomness, no clock read.
    expect(activeEvent(SAT)).toEqual(a);
  });

  test("the sector rotates to the next canonical entry the following Saturday", () => {
    const thisWeek = activeEvent(SAT);
    const nextWeek = activeEvent(NEXT_SAT);
    expect(thisWeek?.sector).toBeDefined();
    expect(nextWeek?.sector).toBeDefined();
    expect(nextWeek?.sector).not.toBe(thisWeek?.sector);
    const index = CANONICAL_SECTORS.indexOf(thisWeek?.sector as string);
    expect(nextWeek?.sector).toBe(
      CANONICAL_SECTORS[(index + 1) % CANONICAL_SECTORS.length] as string,
    );
  });

  test("the window is the whole UTC Saturday, half-open", () => {
    const event = activeEvent(SAT);
    expect(event?.startsAt).toBe("2026-08-22T00:00:00.000Z");
    expect(event?.endsAt).toBe("2026-08-23T00:00:00.000Z");
    // endsAt is exactly where the null answers start.
    expect(activeEvent(new Date(event?.endsAt as string))).toBeNull();
  });

  test("the key is per-occurrence, and the payload is schema-valid", () => {
    const event = activeEvent(SAT);
    expect(event?.key).toBe("sector-saturday:2026-08-22");
    expect(activeEvent(NEXT_SAT)?.key).toBe("sector-saturday:2026-08-29");
    expect(event?.multiplier).toBe(SECTOR_SATURDAY_MULTIPLIER);
    expect(event?.title).toContain("Sector Saturday");
    const parsed = ActiveEvent.parse(event);
    expect(parsed.sector).toBe(event?.sector as string);
    expect(CANONICAL_SECTORS).toContain(parsed.sector as string);
  });

  test("an invalid instant is null, not a thrown error", () => {
    expect(activeEvent(new Date("not a date"))).toBeNull();
  });

  test("EventsResponse carries an explicit null when nothing is open", () => {
    expect(EventsResponse.parse({ active: activeEvent(FRI) }).active).toBeNull();
    expect(EventsResponse.parse({ active: activeEvent(SAT) }).active).not.toBeNull();
  });
});

describe("multiplierForSector", () => {
  const event = activeEvent(SAT) as NonNullable<ReturnType<typeof activeEvent>>;

  test("no event open → base rate", () => {
    expect(multiplierForSector("Energy", null)).toBe(1);
  });

  test("matching sector → the event multiplier; anything else → base rate", () => {
    expect(multiplierForSector(event.sector as string, event)).toBe(SECTOR_SATURDAY_MULTIPLIER);
    const other = CANONICAL_SECTORS.find((s) => s !== event.sector) as string;
    expect(multiplierForSector(other, event)).toBe(1);
    // An unknown sector earns the base rate rather than the bonus.
    expect(multiplierForSector(null, event)).toBe(1);
    expect(multiplierForSector(undefined, event)).toBe(1);
  });

  test("an all-sector event multiplies everything, including unknown sectors", () => {
    const allSectors = { ...event, sector: undefined };
    expect(multiplierForSector(null, allSectors)).toBe(SECTOR_SATURDAY_MULTIPLIER);
    expect(multiplierForSector("Energy", allSectors)).toBe(SECTOR_SATURDAY_MULTIPLIER);
  });
});

describe("seedSectorForFind", () => {
  test("resolves by brand name through the seed's normalized key", () => {
    expect(seedSectorForFind({ brand: "  Chipotle " }, SEED)).toBe("Consumer Discretionary");
  });

  test("canonicalizes an alias sector from the seed", () => {
    expect(seedSectorForFind({ brand: "Apple" }, SEED)).toBe("Information Technology");
  });

  test("falls back to the effective ticker, comparable included", () => {
    expect(seedSectorForFind({ brand: "Unknown Cafe", ticker: "sbux" }, SEED)).toBe(
      "Consumer Discretionary",
    );
    // Private brand → its public comparable decides the sector.
    expect(seedSectorForFind({ brand: "Blue Bottle", comparable: "SBUX" }, SEED)).toBe(
      "Consumer Discretionary",
    );
  });

  test("returns null silently for anything the seed does not know", () => {
    expect(seedSectorForFind({ brand: "Nothing At All" }, SEED)).toBeNull();
    expect(seedSectorForFind({ brand: "Mystery", ticker: "MYST" }, SEED)).toBeNull();
    expect(seedSectorForFind({}, SEED)).toBeNull();
  });
});

describe("applyFindWithMultiplier (call-site multiplier math)", () => {
  const day = "2026-08-22";
  const base = (): UserProgress => defaultProgress();

  test("multiplier 1 is exactly applyFind — applyFind stays pure and event-free", () => {
    const withMultiplier = applyFindWithMultiplier(base(), day, 1);
    const plain = applyFind(base(), day);
    expect(withMultiplier.xp).toBe(plain.xp);
    expect(withMultiplier.xp).toBe(XP_PER_FIND);
    expect(withMultiplier.streakDays).toBe(plain.streakDays);
  });

  test("a 2x event grants XP_PER_FIND * 2 for the find", () => {
    const doubled = applyFindWithMultiplier(base(), day, SECTOR_SATURDAY_MULTIPLIER);
    expect(doubled.xp).toBe(XP_PER_FIND * SECTOR_SATURDAY_MULTIPLIER);
    expect(doubled.xp).toBe(20);
  });

  test("the multiplier touches XP only — never the streak", () => {
    const start: UserProgress = { ...base(), streakDays: 4, lastFindDay: "2026-08-21" };
    const plain = applyFind(start, day);
    const doubled = applyFindWithMultiplier(start, day, 2);
    expect(doubled.streakDays).toBe(plain.streakDays);
    expect(doubled.streakDays).toBe(5);
    expect(doubled.lastFindDay).toBe(plain.lastFindDay);
    expect(doubled.streakFreezes).toBe(plain.streakFreezes);
    expect(doubled.xp - plain.xp).toBe(XP_PER_FIND);
  });

  test("degenerate multipliers fall back to the base rate rather than subtracting XP", () => {
    for (const m of [0, -5, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(applyFindWithMultiplier(base(), day, m).xp).toBe(XP_PER_FIND);
    }
  });

  test("end-to-end: a matching find on Sector Saturday doubles, a non-matching one does not", () => {
    const event = activeEvent(SAT);
    const featured = event?.sector as string;
    const other = CANONICAL_SECTORS.find((s) => s !== featured) as string;

    const matched = applyFindWithMultiplier(base(), day, multiplierForSector(featured, event));
    const missed = applyFindWithMultiplier(base(), day, multiplierForSector(other, event));
    const offDay = applyFindWithMultiplier(
      base(),
      "2026-08-21",
      multiplierForSector(featured, activeEvent(FRI)),
    );

    expect(matched.xp).toBe(20);
    expect(missed.xp).toBe(10);
    expect(offDay.xp).toBe(10);
  });
});
