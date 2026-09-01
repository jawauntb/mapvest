import { describe, expect, test } from "bun:test";
import type { Find, NearbyItem } from "@mapvest/core";
import {
  MAX_PUSHES_PER_DAY,
  MAX_PUSHES_PER_WEEK,
  MIN_SCORE,
  PUSHED_MARKER,
  type UncaughtCandidate,
  type UncaughtScoreContext,
  buildCandidates,
  buildScoreContext,
  dayBudgetValue,
  pickWinner,
  pushesToday,
  scoreCandidate,
  uncaughtBody,
  uncaughtDaySlot,
  uncaughtDedupeSlot,
  uncaughtRelevanceReason,
  uncaughtWeekKey,
  uncaughtWeekSlot,
} from "../src/lib/notifiers/uncaughtNearbyNotifier.js";
import type { WatchEntry } from "../src/lib/watchlist-store.js";

/**
 * Offline only — no POSTGRES_URL, no network. Exercises the pure surface of
 * the uncaught-nearby notifier: the scoring branches, the winner/threshold
 * gate, the durable dedupe + day-budget key shapes, and the push copy.
 * `resolveNearbyItems`, `getQuote` and `sendPush` are never reached from here;
 * fixtures are injected as plain object literals.
 */

const SEED = {
  "jpmorgan chase": { ticker: "JPM", sector: "Financials" },
  starbucks: { ticker: "SBUX", sector: "Consumer Staples" },
  chipotle: { ticker: "CMG", sector: "Consumer Discretionary" },
  nvidia: { ticker: "NVDA", sector: "Information Technology" },
};

function candidate(over: Partial<UncaughtCandidate> = {}): UncaughtCandidate {
  return {
    placeId: "osm:node:1",
    ticker: "JPM",
    brand: "JPMorgan Chase",
    sector: "Financials",
    lat: 40.7411,
    lng: -73.9897,
    distanceM: 200,
    previouslyPushed: false,
    ...over,
  };
}

function ctx(over: Partial<UncaughtScoreContext> = {}): UncaughtScoreContext {
  return {
    affinitySectors: new Set<string>(),
    sectorsWithFinds: new Set<string>(),
    tileHasFinds: true,
    ...over,
  };
}

function nearbyItem(over: {
  id?: string;
  name?: string;
  ticker?: string;
  isPublic?: boolean;
  sector?: string;
  lat?: number;
  lng?: number;
  changePct?: number;
  investable?: boolean;
}): NearbyItem {
  const lat = over.lat ?? 40.7411;
  const lng = over.lng ?? -73.9897;
  const item: NearbyItem = {
    place: {
      id: over.id ?? "osm:node:1",
      name: over.name ?? "JPMorgan Chase",
      location: { lat, lng },
      types: ["bank"],
    },
  };
  if (over.investable === false) return item;
  item.investable = {
    brand: {
      name: over.name ?? "JPMorgan Chase",
      isPublic: over.isPublic ?? true,
      ...(over.ticker ? { ticker: { symbol: over.ticker } } : {}),
      ...(over.sector ? { sector: over.sector } : {}),
    },
    comparables: [],
    etfs: [],
    confidence: "high",
    sources: [{ provider: "manual", fetchedAt: "2026-08-20T12:00:00.000Z", confidence: "high" }],
    ...(over.changePct === undefined
      ? {}
      : {
          quote: {
            symbol: over.ticker ?? "JPM",
            price: 100,
            change: over.changePct,
            changePct: over.changePct,
            currency: "USD",
            ts: "2026-08-20T12:00:00.000Z",
            disclaimer: "Delayed market data. Not investment advice.",
            provider: "massive" as const,
          },
        }),
  };
  return item;
}

// ---------------------------------------------------------------------------
// scoreCandidate
// ---------------------------------------------------------------------------

describe("scoreCandidate", () => {
  test("a candidate with no signal at all scores zero", () => {
    const { score, reasons } = scoreCandidate(
      candidate({ sector: "Financials" }),
      ctx({ sectorsWithFinds: new Set(["Financials"]), tileHasFinds: true }),
    );
    expect(score).toBe(0);
    expect(reasons).toEqual([]);
  });

  test("+2 when the sector matches one the user already collects", () => {
    const { score, reasons } = scoreCandidate(
      candidate(),
      ctx({
        affinitySectors: new Set(["Financials"]),
        sectorsWithFinds: new Set(["Financials"]),
      }),
    );
    expect(score).toBe(2);
    expect(reasons).toEqual(["sector_affinity"]);
  });

  test("+2 when it fills a sector with zero finds", () => {
    const { score, reasons } = scoreCandidate(
      candidate(),
      ctx({ sectorsWithFinds: new Set(["Consumer Staples"]) }),
    );
    expect(score).toBe(2);
    expect(reasons).toEqual(["empty_sector"]);
  });

  test("watchlisted-but-never-caught stacks affinity and empty-sector to +4", () => {
    const { score, reasons } = scoreCandidate(
      candidate(),
      ctx({ affinitySectors: new Set(["Financials"]), sectorsWithFinds: new Set() }),
    );
    expect(score).toBe(4);
    expect(reasons).toEqual(["sector_affinity", "empty_sector"]);
  });

  test("+1 for a first-ever find opportunity in this tile", () => {
    const { score, reasons } = scoreCandidate(
      candidate(),
      ctx({ sectorsWithFinds: new Set(["Financials"]), tileHasFinds: false }),
    );
    expect(score).toBe(1);
    expect(reasons).toEqual(["first_in_tile"]);
  });

  test("+1 only when a quote is attached and |changePct| exceeds 3", () => {
    const base = ctx({ sectorsWithFinds: new Set(["Financials"]) });
    expect(scoreCandidate(candidate({ changePct: 3 }), base).score).toBe(0);
    expect(scoreCandidate(candidate({ changePct: 3.01 }), base).score).toBe(1);
    expect(scoreCandidate(candidate({ changePct: -4.2 }), base).score).toBe(1);
    // No quote attached at all → the timeliness term simply does not apply.
    expect(scoreCandidate(candidate(), base).reasons).not.toContain("intraday_move");
    expect(scoreCandidate(candidate({ changePct: Number.NaN }), base).score).toBe(0);
  });

  test("previously pushed is a veto, not a penalty", () => {
    const strong = ctx({ affinitySectors: new Set(["Financials"]), tileHasFinds: false });
    const fresh = scoreCandidate(candidate({ changePct: 9 }), strong);
    expect(fresh.score).toBe(6);
    const repeat = scoreCandidate(candidate({ changePct: 9, previouslyPushed: true }), strong);
    expect(repeat.score).toBe(-94);
    expect(repeat.reasons).toContain("already_pushed");
    expect(repeat.score).toBeLessThan(MIN_SCORE);
  });

  test("sector aliases are canonicalized on both sides", () => {
    const { score } = scoreCandidate(
      candidate({ sector: "banks" }),
      ctx({
        affinitySectors: new Set(["Financials"]),
        sectorsWithFinds: new Set(["Financials"]),
      }),
    );
    expect(score).toBe(2);
  });

  test("a candidate with no sector scores no sector terms", () => {
    const { reasons } = scoreCandidate(
      candidate({ sector: undefined }),
      ctx({ affinitySectors: new Set(["Financials"]) }),
    );
    expect(reasons).not.toContain("sector_affinity");
    expect(reasons).not.toContain("empty_sector");
  });

  test("is pure — repeated calls with the same inputs agree", () => {
    const c = candidate({ changePct: 7 });
    const k = ctx({ affinitySectors: new Set(["Financials"]), tileHasFinds: false });
    expect(scoreCandidate(c, k)).toEqual(scoreCandidate(c, k));
  });
});

// ---------------------------------------------------------------------------
// buildScoreContext / buildCandidates / pickWinner
// ---------------------------------------------------------------------------

describe("buildScoreContext", () => {
  const find = (over: Partial<Find>): Find => ({
    id: `f_${Math.random().toString(36).slice(2)}`,
    brand: "Starbucks",
    ticker: "SBUX",
    isPublic: true,
    confidence: "high",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  });

  test("finds contribute to both affinity and sectors-with-finds", () => {
    const c = buildScoreContext({
      finds: [find({ ticker: "SBUX" })],
      watchEntries: [],
      seed: SEED,
      fix: { lat: 40.7411, lng: -73.9897 },
    });
    expect([...c.sectorsWithFinds]).toEqual(["Consumer Staples"]);
    expect(c.affinitySectors.has("Consumer Staples")).toBe(true);
  });

  test("watchlist sectors are affinity only — they never fill a sector", () => {
    const watch: WatchEntry[] = [
      { ticker: "JPM", sector: "Financials", source: "manual", createdAt: "2026-08-01T00:00:00Z" },
    ];
    const c = buildScoreContext({
      finds: [find({ ticker: "SBUX" })],
      watchEntries: watch,
      seed: SEED,
      fix: { lat: 40.7411, lng: -73.9897 },
    });
    expect(c.affinitySectors.has("Financials")).toBe(true);
    expect(c.sectorsWithFinds.has("Financials")).toBe(false);
  });

  test("a private find contributes through its comparable", () => {
    const c = buildScoreContext({
      finds: [find({ ticker: undefined, isPublic: false, comparable: "cmg", brand: "Cava" })],
      watchEntries: [],
      seed: SEED,
      fix: { lat: 40.7411, lng: -73.9897 },
    });
    expect(c.sectorsWithFinds.has("Consumer Discretionary")).toBe(true);
  });

  test("tileHasFinds is true only for a geohash-6 tile the user already caught in", () => {
    const here = { lat: 40.7411, lng: -73.9897 };
    const withFind = buildScoreContext({
      finds: [find({ lat: here.lat + 0.0001, lng: here.lng + 0.0001 })],
      watchEntries: [],
      seed: SEED,
      fix: here,
    });
    expect(withFind.tileHasFinds).toBe(true);

    const elsewhere = buildScoreContext({
      finds: [find({ lat: 34.05, lng: -118.24 })],
      watchEntries: [],
      seed: SEED,
      fix: here,
    });
    expect(elsewhere.tileHasFinds).toBe(false);

    // A find without coordinates is never defaulted onto null island.
    const noCoords = buildScoreContext({
      finds: [find({})],
      watchEntries: [],
      seed: SEED,
      fix: here,
    });
    expect(noCoords.tileHasFinds).toBe(false);
  });
});

describe("buildCandidates", () => {
  const origin = { lat: 40.7411, lng: -73.9897 };

  test("keeps public, ticker-resolved items the user does not already own", () => {
    const out = buildCandidates({
      items: [
        nearbyItem({ ticker: "JPM", name: "JPMorgan Chase", sector: "Financials" }),
        nearbyItem({ id: "p2", ticker: "SBUX", name: "Starbucks" }),
      ],
      origin,
      ownedTickers: new Set(["SBUX"]),
      pushedTickers: new Set(),
    });
    expect(out.map((c) => c.ticker)).toEqual(["JPM"]);
    expect(out[0]?.placeId).toBe("osm:node:1");
    expect(out[0]?.sector).toBe("Financials");
    expect(out[0]?.previouslyPushed).toBe(false);
  });

  test("drops private brands, un-tickered brands, and non-investable places", () => {
    const out = buildCandidates({
      items: [
        nearbyItem({ id: "p1", name: "Joe's Deli", investable: false }),
        nearbyItem({ id: "p2", name: "Blue Bottle", isPublic: false, ticker: "SBUX" }),
        nearbyItem({ id: "p3", name: "Some Chain" }),
      ],
      origin,
      ownedTickers: new Set(),
      pushedTickers: new Set(),
    });
    expect(out).toEqual([]);
  });

  test("dedupes a chain by ticker, keeping the nearest storefront", () => {
    const out = buildCandidates({
      items: [
        nearbyItem({ id: "far", ticker: "SBUX", lat: origin.lat + 0.005, lng: origin.lng }),
        nearbyItem({ id: "near", ticker: "SBUX", lat: origin.lat + 0.0005, lng: origin.lng }),
      ],
      origin,
      ownedTickers: new Set(),
      pushedTickers: new Set(),
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.placeId).toBe("near");
    expect(out[0]?.distanceM).toBeLessThan(100);
  });

  test("attaches changePct only when a real quote rode along", () => {
    const [withQuote] = buildCandidates({
      items: [nearbyItem({ ticker: "JPM", changePct: -6.4 })],
      origin,
      ownedTickers: new Set(),
      pushedTickers: new Set(),
    });
    expect(withQuote?.changePct).toBe(-6.4);

    const [withoutQuote] = buildCandidates({
      items: [nearbyItem({ ticker: "JPM" })],
      origin,
      ownedTickers: new Set(),
      pushedTickers: new Set(),
    });
    expect(withoutQuote?.changePct).toBeUndefined();
  });

  test("marks candidates whose once-ever slot is already spent", () => {
    const [only] = buildCandidates({
      items: [nearbyItem({ ticker: "JPM" })],
      origin,
      ownedTickers: new Set(),
      pushedTickers: new Set(["JPM"]),
    });
    expect(only?.previouslyPushed).toBe(true);
  });

  test("ticker matching is case-insensitive against the owned set", () => {
    const out = buildCandidates({
      items: [nearbyItem({ ticker: "jpm" })],
      origin,
      ownedTickers: new Set(["JPM"]),
      pushedTickers: new Set(),
    });
    expect(out).toEqual([]);
  });
});

describe("pickWinner", () => {
  const strong = ctx({ affinitySectors: new Set(["Financials"]), tileHasFinds: false });

  test("returns nothing when the best candidate is under the threshold", () => {
    const weak = ctx({ sectorsWithFinds: new Set(["Financials"]), tileHasFinds: true });
    expect(pickWinner([candidate(), candidate({ ticker: "SBUX" })], weak)).toBeNull();
  });

  test("MIN_SCORE is the gate — 3 passes, 2 does not", () => {
    // sector affinity (+2) + first in tile (+1) = 3.
    const atThreshold = ctx({
      affinitySectors: new Set(["Financials"]),
      sectorsWithFinds: new Set(["Financials"]),
      tileHasFinds: false,
    });
    expect(MIN_SCORE).toBe(3);
    expect(pickWinner([candidate()], atThreshold)?.score).toBe(3);

    const below = ctx({
      affinitySectors: new Set(["Financials"]),
      sectorsWithFinds: new Set(["Financials"]),
      tileHasFinds: true,
    });
    expect(pickWinner([candidate()], below)).toBeNull();
  });

  test("returns exactly one winner — the highest score", () => {
    const winner = pickWinner(
      [
        candidate({ ticker: "JPM", sector: "Financials", distanceM: 700 }),
        candidate({ ticker: "NVDA", sector: "Information Technology", distanceM: 100 }),
      ],
      strong,
    );
    expect(winner?.candidate.ticker).toBe("JPM");
    expect(winner?.score).toBe(5);
  });

  test("ties break toward the nearer candidate", () => {
    const winner = pickWinner(
      [
        candidate({ ticker: "NVDA", sector: "Information Technology", distanceM: 700 }),
        candidate({ ticker: "CMG", sector: "Consumer Discretionary", distanceM: 120 }),
      ],
      strong,
    );
    expect(winner?.candidate.ticker).toBe("CMG");
  });

  test("an already-pushed candidate can never win, however strong", () => {
    const winner = pickWinner([candidate({ changePct: 12, previouslyPushed: true })], strong);
    expect(winner).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Budget + dedupe key shapes
// ---------------------------------------------------------------------------

describe("dedupe + budget key shapes", () => {
  const tok = (lastSent: Record<string, string>) => ({ prefs: { last_sent: lastSent } });

  const TOKEN_ID = "push_phone";
  const DAY_SLOT = uncaughtDaySlot(TOKEN_ID);

  test("the per-ticker slot is uncaught:{tokenId}:{TICKER}, normalized and device-scoped", () => {
    expect(uncaughtDedupeSlot(TOKEN_ID, "JPM")).toBe("uncaught:push_phone:JPM");
    expect(uncaughtDedupeSlot(TOKEN_ID, " jpm ")).toBe("uncaught:push_phone:JPM");
    expect(uncaughtDedupeSlot(TOKEN_ID, "JPM")).not.toBe(uncaughtDedupeSlot("push_tablet", "JPM"));
    expect(PUSHED_MARKER).toBe("1");
  });

  test("the day slot is device-scoped with a {ymd}:{count} value", () => {
    expect(uncaughtDaySlot(TOKEN_ID)).toBe("uncaught_day:push_phone");
    expect(uncaughtDaySlot(TOKEN_ID)).not.toBe(uncaughtDaySlot("push_tablet"));
    expect(dayBudgetValue("20260820", 1)).toBe("20260820:1");
    expect(dayBudgetValue("20260820", MAX_PUSHES_PER_DAY)).toBe("20260820:1");
  });

  test("pushesToday counts today's spend and ignores other days", () => {
    expect(pushesToday(tok({}), "20260820", DAY_SLOT)).toBe(0);
    expect(pushesToday(tok({ [DAY_SLOT]: "20260819:2" }), "20260820", DAY_SLOT)).toBe(0);
    expect(pushesToday(tok({ [DAY_SLOT]: "20260820:1" }), "20260820", DAY_SLOT)).toBe(1);
  });

  test("one device's budget never debits its sibling device", () => {
    const tabletSlot = uncaughtDaySlot("push_tablet");
    const phone = tok({ [DAY_SLOT]: "20260820:1" });
    const tablet = tok({ [tabletSlot]: "20260820:1" });
    expect(pushesToday(phone, "20260820", DAY_SLOT)).toBe(MAX_PUSHES_PER_DAY);
    expect(pushesToday(tablet, "20260820", tabletSlot)).toBe(1);
    expect(pushesToday(tablet, "20260820", DAY_SLOT)).toBe(0);
  });

  test("MAX_PUSHES_PER_DAY is one, and a malformed value never grants budget", () => {
    expect(MAX_PUSHES_PER_DAY).toBe(1);
    expect(pushesToday(tok({ [DAY_SLOT]: "garbage" }), "20260820", DAY_SLOT)).toBe(0);
    expect(pushesToday(tok({ [DAY_SLOT]: "20260820:" }), "20260820", DAY_SLOT)).toBe(0);
    expect(pushesToday(tok({ [DAY_SLOT]: "20260820:nope" }), "20260820", DAY_SLOT)).toBe(0);
  });

  test("the per-ticker slot never collides with the day slot", () => {
    expect(uncaughtDedupeSlot(TOKEN_ID, "DAY")).not.toBe(uncaughtDaySlot(TOKEN_ID));
  });

  test("the weekly budget is device-scoped, Monday-based, and capped at three", () => {
    const weekSlot = uncaughtWeekSlot(TOKEN_ID);
    const weekKey = uncaughtWeekKey(new Date("2026-08-20T12:00:00.000Z"));
    expect(weekKey).toBe("20260817");
    expect(weekSlot).toBe("uncaught_week:push_phone");
    expect(MAX_PUSHES_PER_WEEK).toBe(3);
    expect(pushesToday(tok({ [weekSlot]: `${weekKey}:3` }), weekKey, weekSlot)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

describe("uncaughtBody", () => {
  test("collection framing, never advice", () => {
    const body = uncaughtBody("JPMorgan Chase", "JPM");
    expect(body).toBe("JPMorgan Chase (JPM) is nearby and isn't in your universe yet");
    expect(body).not.toMatch(/\b(buy|sell|should|hold|invest in)\b/i);
  });

  test("claims a distance only when a real one was measured", () => {
    expect(uncaughtBody("JPMorgan Chase", "JPM", 204)).toBe(
      "JPMorgan Chase (JPM) is 200m away and isn't in your universe yet",
    );
    expect(uncaughtBody("JPMorgan Chase", "jpm", undefined)).toContain("is nearby and");
    expect(uncaughtBody("JPMorgan Chase", "JPM", Number.NaN)).toContain("is nearby and");
    expect(uncaughtBody("Costco", "COST", 2400)).toContain("2.4km away");
  });

  test("the symbol is normalized into the copy", () => {
    expect(uncaughtBody("Starbucks", " sbux ")).toContain("(SBUX)");
  });
});

describe("uncaughtRelevanceReason", () => {
  test("explains the strongest product-relevant signal in plain language", () => {
    expect(
      uncaughtRelevanceReason(candidate({ brand: "JPMorgan Chase", sector: "Financials" }), [
        "sector_affinity",
        "first_in_tile",
      ]),
    ).toBe("JPMorgan Chase matches the Financials companies you already explore.");
    expect(uncaughtRelevanceReason(candidate({ brand: "NVIDIA" }), ["first_in_tile"])).toBe(
      "NVIDIA is a new company near this part of your map.",
    );
  });
});
