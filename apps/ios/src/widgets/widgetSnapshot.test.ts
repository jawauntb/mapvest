import { describe, expect, test } from "bun:test";
import {
  WIDGET_DISCOVERY_TTL_MS,
  composeWidgetDiscoverySnapshot,
  parseWidgetDiscoverySnapshot,
  personalizeWidgetDiscoverySnapshot,
  selectWidgetDiscoverySnapshot,
} from "./widgetSnapshot";

const NOW = Date.parse("2026-09-01T20:00:00.000Z");
const accountScope = { kind: "account" as const, accountId: "user-one", epoch: "epoch-one" };
const source = {
  provider: "exa" as const,
  url: "https://example.com/company",
  fetchedAt: "2026-09-01T19:55:00.000Z",
  confidence: "high" as const,
};
const nearby = [
  {
    name: "Caught Coffee",
    ticker: "SBUX",
    sector: "Consumer",
    distanceM: 40,
    isPublic: true,
    confidence: "high" as const,
    sources: [source],
  },
  {
    name: "Fresh Bank",
    ticker: "JPM",
    sector: "Financials",
    distanceM: 120,
    isPublic: true,
    confidence: "high" as const,
    sources: [source],
  },
  {
    name: "Private Shop",
    ticker: "WMT",
    sector: "Retail",
    distanceM: 200,
    isPublic: false,
    confidence: "medium" as const,
    sources: [{ ...source, confidence: "medium" as const }],
  },
  {
    name: "Duplicate Bank",
    ticker: "jpm",
    sector: "Financials",
    distanceM: 300,
    isPublic: true,
    confidence: "high" as const,
    sources: [source],
  },
  { name: "No cited ticker", distanceM: 10 },
];

function personalizedSnapshot() {
  return composeWidgetDiscoverySnapshot({
    scope: accountScope,
    location: { status: "fresh", source: "device", label: "Nearby" },
    nearby,
    finds: [{ ticker: "SBUX" }],
    quests: [
      { id: "done", title: "Done", progress: 1, target: 1, completed: true, xp: 10 },
      { id: "open", title: "Catch one company", progress: 0, target: 1, completed: false, xp: 25 },
    ],
    dex: {
      sectors: [
        { found: 2, total: 10 },
        { found: 1, total: 4 },
      ],
      tilesVisited: 2,
    },
    nowMs: NOW,
  });
}

describe("WidgetDiscoverySnapshotV1 composition", () => {
  test("ranks uncaught investables first and includes only sourced, exact company links", () => {
    const snapshot = personalizedSnapshot();
    expect(snapshot.cards.map((card) => [card.ticker, card.caught])).toEqual([
      ["JPM", false],
      ["WMT", false],
      ["SBUX", true],
    ]);
    expect(snapshot.cards.every((card) => card.deepLink.startsWith("mapvest:///detail/"))).toBe(
      true,
    );
    expect(snapshot.cards.find((card) => card.ticker === "WMT")?.isPublic).toBe(false);
    expect(snapshot.cards.find((card) => card.ticker === "WMT")).toMatchObject({
      confidence: "medium",
      sources: [{ provider: "exa" }],
      relevance: "Private brand with a public comparable",
    });
    expect(snapshot.quest?.title).toBe("Catch one company");
    expect(snapshot.dex).toMatchObject({ found: 3, total: 14, tilesVisited: 2 });
    expect(Date.parse(snapshot.expiresAt) - Date.parse(snapshot.generatedAt)).toBe(
      WIDGET_DISCOVERY_TTL_MS,
    );
  });

  test("guest snapshots never contain collection, quest, or dex language", () => {
    const snapshot = composeWidgetDiscoverySnapshot({
      scope: { kind: "guest" },
      location: { status: "fresh", source: "demo", label: "Explore demo area" },
      nearby,
      finds: [{ ticker: "SBUX" }],
      quests: [{ id: "q", title: "Private", progress: 1, target: 1, completed: true, xp: 10 }],
      dex: { sectors: [{ found: 2, total: 3 }], tilesVisited: 1 },
      nowMs: NOW,
    });
    expect(snapshot.scope).toEqual({ kind: "guest" });
    expect(snapshot.quest).toBeUndefined();
    expect(snapshot.dex).toBeUndefined();
    expect(snapshot.cards.every((card) => card.caught === false)).toBe(true);
  });

  test("serialized snapshots round-trip without coordinates, tokens, or secrets", () => {
    const snapshot = personalizedSnapshot();
    const serialized = JSON.stringify(snapshot);
    expect(parseWidgetDiscoverySnapshot(serialized)).toEqual(snapshot);
    expect(serialized).not.toMatch(/"(?:lat|lng|price|changePct|news)"|bearer|token|secret/i);
  });

  test("rejects personal fields or non-exact links in a guest snapshot", () => {
    const guest = composeWidgetDiscoverySnapshot({
      scope: { kind: "guest" },
      location: { status: "fresh", source: "demo", label: "Explore demo area" },
      nearby,
      nowMs: NOW,
    });
    expect(
      parseWidgetDiscoverySnapshot({
        ...guest,
        cards: [{ ...guest.cards[0], caught: true }],
      }),
    ).toBeNull();
    expect(
      parseWidgetDiscoverySnapshot({
        ...guest,
        cards: [{ ...guest.cards[0], deepLink: "mapvest:///settings" }],
      }),
    ).toBeNull();
    expect(
      parseWidgetDiscoverySnapshot({
        ...guest,
        cards: [{ ...guest.cards[0], sources: [], confidence: "high" }],
      }),
    ).toBeNull();
    expect(
      parseWidgetDiscoverySnapshot({
        ...guest,
        quest: {
          id: "private",
          title: "Private quest",
          progress: 0,
          target: 1,
          completed: false,
          xp: 10,
          deepLink: "mapvest:///universe",
        },
      }),
    ).toBeNull();
  });
});

describe("widget snapshot selection", () => {
  test("fails closed on corruption and account or epoch mismatch", () => {
    const raw = JSON.stringify(personalizedSnapshot());
    expect(
      selectWidgetDiscoverySnapshot({ raw: "{broken", activeScope: accountScope, nowMs: NOW }),
    ).toEqual({ kind: "setup", reason: "corrupt" });
    expect(
      selectWidgetDiscoverySnapshot({
        raw,
        activeScope: { ...accountScope, epoch: "other" },
        nowMs: NOW,
      }),
    ).toEqual({ kind: "setup", reason: "scope-mismatch" });
    expect(selectWidgetDiscoverySnapshot({ raw, activeScope: null, nowMs: NOW })).toEqual({
      kind: "setup",
      reason: "scope-mismatch",
    });
  });

  test("keeps a matching last-good snapshot while labeling expiry and denied location", () => {
    const snapshot = personalizedSnapshot();
    expect(
      selectWidgetDiscoverySnapshot({
        raw: JSON.stringify(snapshot),
        activeScope: accountScope,
        nowMs: NOW,
      }),
    ).toMatchObject({ kind: "fresh" });
    expect(
      selectWidgetDiscoverySnapshot({
        raw: JSON.stringify(snapshot),
        activeScope: accountScope,
        nowMs: Date.parse(snapshot.expiresAt) + 1,
      }),
    ).toMatchObject({ kind: "stale", reason: "expired" });
    expect(
      selectWidgetDiscoverySnapshot({
        raw: JSON.stringify({ ...snapshot, location: { ...snapshot.location, status: "denied" } }),
        activeScope: accountScope,
        nowMs: NOW,
      }),
    ).toMatchObject({ kind: "stale", reason: "denied" });
    expect(
      selectWidgetDiscoverySnapshot({
        raw: JSON.stringify({
          ...snapshot,
          cards: [],
          location: { ...snapshot.location, status: "unavailable" },
        }),
        activeScope: accountScope,
        nowMs: NOW,
      }),
    ).toMatchObject({ kind: "stale", reason: "unavailable", snapshot: { cards: [] } });
  });

  test("keeps an honest fresh empty state instead of inventing a nearby company", () => {
    const snapshot = composeWidgetDiscoverySnapshot({
      scope: { kind: "guest" },
      location: { status: "fresh", source: "map", label: "Map area" },
      nearby: [{ name: "Unresolved place without a ticker", distanceM: 30 }],
      nowMs: NOW,
    });
    expect(snapshot.cards).toEqual([]);
    expect(
      selectWidgetDiscoverySnapshot({
        raw: JSON.stringify(snapshot),
        activeScope: null,
        nowMs: NOW,
      }),
    ).toMatchObject({ kind: "fresh", snapshot: { cards: [] } });
  });

  test("personalization refresh cannot cross an account epoch", () => {
    const snapshot = personalizedSnapshot();
    expect(
      personalizeWidgetDiscoverySnapshot({
        snapshot,
        scope: { ...accountScope, epoch: "other" },
        finds: [],
        quests: [],
        dex: { sectors: [], tilesVisited: 0 },
      }),
    ).toBeNull();
    const updated = personalizeWidgetDiscoverySnapshot({
      snapshot,
      scope: accountScope,
      finds: [{ ticker: "JPM" }],
      quests: [],
      dex: { sectors: [{ found: 1, total: 2 }], tilesVisited: 1 },
    });
    expect(updated?.cards.map((card) => [card.ticker, card.caught])).toEqual([
      ["SBUX", false],
      ["WMT", false],
      ["JPM", true],
    ]);
    expect(updated?.cards.find((card) => card.ticker === "WMT")?.relevance).toBe(
      "Private brand with a public comparable",
    );
  });
});
