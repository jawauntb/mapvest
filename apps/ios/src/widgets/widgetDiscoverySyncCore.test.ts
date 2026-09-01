import { describe, expect, test } from "bun:test";
import type { DexResponse, NearbyItem, QuestsResponse } from "@/api/types";
import { deviceOriginContext } from "@/location/locationContext";
import {
  type WidgetDiscoverySyncDependencies,
  synchronizeWidgetDiscovery,
} from "./widgetDiscoverySyncCore";
import type { WidgetDiscoverySnapshotV1, WidgetSnapshotScope } from "./widgetSnapshot";

const source = {
  provider: "exa" as const,
  url: "https://example.com/private-shop",
  fetchedAt: "2026-09-01T20:00:00.000Z",
  confidence: "high" as const,
};

const item: NearbyItem = {
  place: {
    id: "place-one",
    name: "Private Shop",
    location: { lat: 40.001, lng: -73.999 },
    types: ["store"],
  },
  investable: {
    brand: { name: "Private Shop", isPublic: false, sector: "Retail" },
    comparables: [
      {
        ticker: "WMT",
        name: "Walmart",
        score: 0.8,
        reasoning: "Public retail comparable",
        sources: [source],
      },
    ],
    etfs: [],
    confidence: "high",
    sources: [],
  },
};

const dex: DexResponse = {
  sectors: [{ sector: "Retail", found: 1, total: 4 }],
  tilesVisited: 2,
  totalFinds: 1,
  rarityCounts: { common: 1, uncommon: 0, rare: 0, legendary: 0 },
};

const quests: QuestsResponse = {
  quests: [
    {
      id: "2026-09-01:catch_any",
      kind: "catch_any",
      title: "Catch one company",
      xp: 25,
      completed: false,
      progress: 0,
      target: 1,
    },
  ],
  day: "2026-09-01",
  xpGrantedToday: 0,
};

const accountScope: WidgetSnapshotScope = {
  kind: "account",
  accountId: "user-one",
  epoch: "epoch-one",
};

function harness(overrides: Partial<WidgetDiscoverySyncDependencies> = {}) {
  const writes: WidgetDiscoverySnapshotV1[] = [];
  const dependencies: WidgetDiscoverySyncDependencies = {
    activate: async () => accountScope,
    activeScope: async () => accountScope,
    loadPersonalization: async () => ({
      finds: [],
      dex,
      quests,
    }),
    write: async (snapshot) => {
      writes.push(snapshot);
      return true;
    },
    isLatest: () => true,
    ...overrides,
  };
  return { dependencies, writes };
}

const args = {
  session: { accountId: "user-one", authGeneration: 4 },
  token: "session-token",
  context: deviceOriginContext({
    latitude: 40,
    longitude: -74,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  }),
  origin: { lat: 40, lng: -74 },
  items: [item],
};

describe("widget discovery synchronization", () => {
  test("writes one exact account snapshot with comparable provenance", async () => {
    const { dependencies, writes } = harness();
    expect(await synchronizeWidgetDiscovery(args, dependencies)).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.scope).toEqual(accountScope);
    expect(writes[0]?.cards[0]).toMatchObject({
      ticker: "WMT",
      isPublic: false,
      confidence: "high",
      sources: [{ provider: "exa" }],
      relevance: "Private brand with a public comparable",
    });
  });

  test("preserves the last-good snapshot when any personal read fails", async () => {
    const { dependencies, writes } = harness({
      loadPersonalization: async () => {
        throw new Error("dex unavailable");
      },
    });
    expect(await synchronizeWidgetDiscovery(args, dependencies)).toBe(false);
    expect(writes).toHaveLength(0);
  });

  test("releases a never-settling personal join at the deadline", async () => {
    const { dependencies, writes } = harness({
      loadPersonalization: async () => new Promise(() => {}),
      timeoutMs: 5,
    });
    expect(await synchronizeWidgetDiscovery(args, dependencies)).toBe(false);
    expect(writes).toHaveLength(0);
  });

  test("rejects a reverse-order completion after a newer location wins", async () => {
    let latest = true;
    const { dependencies, writes } = harness({
      loadPersonalization: async () => {
        latest = false;
        return { finds: [], dex, quests };
      },
      isLatest: () => latest,
    });
    expect(await synchronizeWidgetDiscovery(args, dependencies)).toBe(false);
    expect(writes).toHaveLength(0);
  });

  test("rejects persisted scope from a different account", async () => {
    const { dependencies, writes } = harness({
      activate: async () => ({
        kind: "account",
        accountId: "user-two",
        epoch: "epoch-two",
      }),
    });
    expect(await synchronizeWidgetDiscovery(args, dependencies)).toBe(false);
    expect(writes).toHaveLength(0);
  });
});
