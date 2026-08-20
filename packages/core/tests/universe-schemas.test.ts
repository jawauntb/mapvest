import { describe, expect, test } from "bun:test";
import {
  ActiveEvent,
  CompanyEdge,
  CompanyEdgeType,
  CompanyGraphResponse,
  CreateRivalryRequest,
  DemandPulse,
  DemandPulseBuyer,
  DexRarity,
  DexRarityCounts,
  DexResponse,
  DexSector,
  EnvironmentBrief,
  EnvironmentSeries,
  EventsResponse,
  ProgressResponse,
  Quest,
  QuestKind,
  QuestsResponse,
  RivalriesResponse,
  Rivalry,
  SynthesisMemoResponse,
  TerritoryResponse,
  UniverseSummary,
  UserProgress,
} from "../src/schemas/index.js";

/**
 * Offline-only wire-shape tests for the Universe Roadmap slices
 * (A1/A3/A4/A5/A6/A7 and C1/C3/C4/C5/C6). Downstream agents build routes and
 * stores against these exact shapes, so the assertions below pin field names,
 * optionality, and the AGENTS.md §6 `sources: Source[]` requirement rather than
 * any runtime behavior.
 */

const source = {
  provider: "sec" as const,
  url: "https://www.sec.gov/Archives/edgar/data/1045810/nvda-10k.htm",
  fetchedAt: "2026-08-19T00:00:00.000Z",
  confidence: "high" as const,
};

describe("UserProgress / ProgressResponse", () => {
  const progress = {
    xp: 420,
    level: 5,
    streakDays: 12,
    streakFreezes: 2,
    lastFindDay: "2026-08-19",
    badges: ["sector:Consumer Staples", "tile:dr5ru7"],
    updatedAt: "2026-08-19T12:00:00.000Z",
  };

  test("parses a full progression row", () => {
    expect(UserProgress.parse(progress)).toEqual(progress);
  });

  test("badges defaults to an empty array for a row written before badges existed", () => {
    const { badges: _omitted, ...noBadges } = progress;
    expect(UserProgress.parse(noBadges).badges).toEqual([]);
  });

  test("badge keys are opaque strings — an unknown family still parses", () => {
    expect(UserProgress.parse({ ...progress, badges: ["rivalry:streak:3"] }).badges).toEqual([
      "rivalry:streak:3",
    ]);
    expect(UserProgress.safeParse({ ...progress, badges: [42] }).success).toBe(false);
  });

  test("lastFindDay is optional (a user with no finds yet)", () => {
    const fresh = {
      xp: 0,
      level: 1,
      streakDays: 0,
      streakFreezes: 0,
      updatedAt: "2026-08-19T12:00:00.000Z",
    };
    expect(UserProgress.parse(fresh).lastFindDay).toBeUndefined();
    expect(UserProgress.parse(fresh).badges).toEqual([]);
  });

  test("rejects a row missing a required counter", () => {
    const { streakFreezes: _omitted, ...partial } = progress;
    expect(UserProgress.safeParse(partial).success).toBe(false);
  });

  test("ProgressResponse wraps progress under `progress`", () => {
    expect(ProgressResponse.parse({ progress }).progress.streakDays).toBe(12);
    expect(ProgressResponse.safeParse(progress).success).toBe(false);
  });
});

describe("UniverseSummary", () => {
  const summary = {
    findCount: 10,
    valuedFinds: 7,
    hypotheticalBasis: 700,
    hypotheticalValue: 812.5,
    changePct: 16.07,
    generatedAt: "2026-08-19T12:00:00.000Z",
    sources: [source],
  };

  test("parses the counterfactual aggregate", () => {
    expect(UniverseSummary.parse(summary)).toEqual(summary);
  });

  test("valuedFinds may trail findCount (finds without foundPrice are excluded, not faked)", () => {
    const parsed = UniverseSummary.parse(summary);
    expect(parsed.valuedFinds).toBeLessThan(parsed.findCount);
  });

  test("negative change and an empty universe are representable", () => {
    const empty = UniverseSummary.parse({
      findCount: 0,
      valuedFinds: 0,
      hypotheticalBasis: 0,
      hypotheticalValue: 0,
      changePct: -0,
      generatedAt: "2026-08-19T12:00:00.000Z",
      sources: [],
    });
    expect(empty.sources).toEqual([]);
    expect(UniverseSummary.parse({ ...summary, changePct: -12.5 }).changePct).toBe(-12.5);
  });

  test("requires a sources array (AGENTS.md §6)", () => {
    const { sources: _omitted, ...noSources } = summary;
    expect(UniverseSummary.safeParse(noSources).success).toBe(false);
  });
});

describe("Dex", () => {
  test("DexRarity enumerates exactly the four tiers", () => {
    expect(DexRarity.options).toEqual(["common", "uncommon", "rare", "legendary"]);
    expect(DexRarity.safeParse("mythic").success).toBe(false);
  });

  test("DexSector carries found/total per sector", () => {
    expect(DexSector.parse({ sector: "Consumer Staples", found: 14, total: 89 })).toEqual({
      sector: "Consumer Staples",
      found: 14,
      total: 89,
    });
  });

  test("DexRarityCounts covers exactly the four tiers", () => {
    const counts = { common: 9, uncommon: 5, rare: 2, legendary: 1 };
    expect(DexRarityCounts.parse(counts)).toEqual(counts);
    for (const tier of DexRarity.options) {
      const { [tier]: _omitted, ...missing } = counts;
      expect(DexRarityCounts.safeParse(missing).success).toBe(false);
    }
  });

  test("DexResponse parses sectors plus regional tiles and the rarity histogram", () => {
    const dex = {
      sectors: [
        { sector: "Consumer Staples", found: 14, total: 89 },
        { sector: "Technology", found: 3, total: 61 },
      ],
      tilesVisited: 8,
      totalFinds: 17,
      rarityCounts: { common: 9, uncommon: 5, rare: 2, legendary: 1 },
    };
    expect(DexResponse.parse(dex)).toEqual(dex);

    const parsed = DexResponse.parse(dex);
    const { common, uncommon, rare, legendary } = parsed.rarityCounts;
    expect(common + uncommon + rare + legendary).toBe(parsed.totalFinds);
  });

  test("rarityCounts is required — a dex without it is not a valid response", () => {
    expect(
      DexResponse.safeParse({
        sectors: [],
        tilesVisited: 0,
        totalFinds: 0,
      }).success,
    ).toBe(false);
  });

  test("rejects a sector row missing `total`", () => {
    expect(
      DexResponse.safeParse({
        sectors: [{ sector: "Technology", found: 3 }],
        tilesVisited: 1,
        totalFinds: 3,
        rarityCounts: { common: 3, uncommon: 0, rare: 0, legendary: 0 },
      }).success,
    ).toBe(false);
  });
});

describe("CompanyEdge / CompanyGraphResponse", () => {
  const edge = {
    id: "edge_nvda_tsmc",
    srcTicker: "NVDA",
    dstTicker: "TSM",
    dstName: "Taiwan Semiconductor Manufacturing Company",
    edgeType: "supplies" as const,
    weight: 0.9,
    reasoning: "10-K item 1 names TSMC as the foundry for substantially all GPU wafer supply.",
    sources: [source],
    asOf: "2026-01-26",
    createdAt: "2026-08-19T12:00:00.000Z",
  };

  test("CompanyEdgeType enumerates the vertical and lateral relations", () => {
    expect(CompanyEdgeType.options).toEqual([
      "supplies",
      "buys_from",
      "competes_with",
      "complements",
    ]);
    expect(CompanyEdgeType.safeParse("partners_with").success).toBe(false);
  });

  test("parses a fully cited edge", () => {
    expect(CompanyEdge.parse(edge)).toEqual(edge);
  });

  test("a private counterparty keeps dstName with no dstTicker", () => {
    const { dstTicker: _omitted, asOf: _alsoOmitted, ...priv } = edge;
    const parsed = CompanyEdge.parse({ ...priv, dstName: "SK hynix (private JV arm)" });
    expect(parsed.dstTicker).toBeUndefined();
    expect(parsed.dstName).toBe("SK hynix (private JV arm)");
    expect(parsed.asOf).toBeUndefined();
  });

  test("weight is clamped to 0..1 by validation, not by coercion", () => {
    expect(CompanyEdge.safeParse({ ...edge, weight: 1.4 }).success).toBe(false);
    expect(CompanyEdge.safeParse({ ...edge, weight: -0.1 }).success).toBe(false);
    expect(CompanyEdge.parse({ ...edge, weight: 0 }).weight).toBe(0);
    expect(CompanyEdge.parse({ ...edge, weight: 1 }).weight).toBe(1);
  });

  test("every edge must carry sources (AGENTS.md §6)", () => {
    const { sources: _omitted, ...noSources } = edge;
    expect(CompanyEdge.safeParse(noSources).success).toBe(false);
    expect(CompanyEdge.parse({ ...edge, sources: [] }).sources).toEqual([]);
  });

  test("CompanyGraphResponse wraps edges with count and generatedAt", () => {
    const graph = {
      ticker: "NVDA",
      edges: [edge],
      count: 1,
      generatedAt: "2026-08-19T12:00:00.000Z",
      sources: [source],
    };
    expect(CompanyGraphResponse.parse(graph)).toEqual(graph);
    expect(
      CompanyGraphResponse.parse({ ...graph, edges: [], count: 0, sources: [] }).edges,
    ).toEqual([]);
  });

  test("rejects an edge with an unknown edgeType inside the graph response", () => {
    expect(
      CompanyGraphResponse.safeParse({
        ticker: "NVDA",
        edges: [{ ...edge, edgeType: "sells_to" }],
        count: 1,
        generatedAt: "2026-08-19T12:00:00.000Z",
        sources: [],
      }).success,
    ).toBe(false);
  });
});

describe("Quest / QuestsResponse", () => {
  const quest = {
    id: "2026-08-19:catch_private",
    kind: "catch_private" as const,
    title: "Catch a private brand",
    xp: 25,
    completed: false,
    progress: 0,
    target: 1,
  };

  test("QuestKind enumerates only server-verifiable actions", () => {
    expect(QuestKind.options).toEqual(["catch_any", "catch_private", "new_tile", "new_sector"]);
    expect(QuestKind.safeParse("share_find").success).toBe(false);
  });

  test("parses a quest row", () => {
    expect(Quest.parse(quest)).toEqual(quest);
  });

  test("id is the deterministic `{day}:{kind}` key XP is granted against once", () => {
    const parsed = Quest.parse(quest);
    const [day, kind] = parsed.id.split(":");
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(QuestKind.parse(kind)).toBe(parsed.kind);
  });

  test("completion is a server-computed field, not an optional client claim", () => {
    const { completed: _omitted, ...noCompleted } = quest;
    expect(Quest.safeParse(noCompleted).success).toBe(false);
    expect(Quest.parse({ ...quest, completed: true, progress: 1 }).completed).toBe(true);
  });

  test("QuestsResponse carries the UTC day and XP already granted", () => {
    const payload = {
      quests: [quest, { ...quest, id: "2026-08-19:new_tile", kind: "new_tile" as const }],
      day: "2026-08-19",
      xpGrantedToday: 50,
    };
    expect(QuestsResponse.parse(payload)).toEqual(payload);
    expect(QuestsResponse.parse(payload).day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("an empty quest day is representable", () => {
    expect(
      QuestsResponse.parse({ quests: [], day: "2026-08-19", xpGrantedToday: 0 }).quests,
    ).toEqual([]);
  });
});

describe("TerritoryResponse", () => {
  const territory = {
    tile: "dr5ru7",
    investablesTotal: 11,
    found: 6,
    pioneer: true,
    sources: [source],
  };

  test("parses tile completion", () => {
    expect(TerritoryResponse.parse(territory)).toEqual(territory);
    expect(TerritoryResponse.parse(territory).tile).toHaveLength(6);
  });

  test("an unvisited tile reports zero found and no pioneer claim", () => {
    const fresh = TerritoryResponse.parse({
      tile: "dr5ru7",
      investablesTotal: 11,
      found: 0,
      pioneer: false,
      sources: [],
    });
    expect(fresh.found).toBe(0);
    expect(fresh.pioneer).toBe(false);
    expect(fresh.sources).toEqual([]);
  });

  test("requires a sources array (AGENTS.md §6)", () => {
    const { sources: _omitted, ...noSources } = territory;
    expect(TerritoryResponse.safeParse(noSources).success).toBe(false);
  });
});

describe("ActiveEvent / EventsResponse", () => {
  const event = {
    key: "sector_saturday_2026_08_22",
    title: "Sector Saturday — Consumer Staples",
    sector: "Consumer Staples",
    multiplier: 2,
    startsAt: "2026-08-22T00:00:00.000Z",
    endsAt: "2026-08-23T00:00:00.000Z",
  };

  test("parses a sector-scoped event window", () => {
    expect(ActiveEvent.parse(event)).toEqual(event);
  });

  test("sector is optional — an all-sector event omits it", () => {
    const { sector: _omitted, ...allSectors } = event;
    expect(ActiveEvent.parse(allSectors).sector).toBeUndefined();
  });

  test("EventsResponse distinguishes `no event` from a missing field", () => {
    expect(EventsResponse.parse({ active: null }).active).toBeNull();
    expect(EventsResponse.parse({ active: event }).active?.multiplier).toBe(2);
    expect(EventsResponse.safeParse({}).success).toBe(false);
  });
});

describe("Rivalry / RivalriesResponse / CreateRivalryRequest", () => {
  const rivalry = {
    id: "riv_nvda_amd",
    ticker: "NVDA",
    rivalTicker: "AMD",
    wins: 3,
    losses: 1,
    draws: 0,
    currentPick: "ticker" as const,
    weekStart: "2026-08-17",
    createdAt: "2026-07-06T12:00:00.000Z",
  };

  test("parses a tracked matchup with its running record", () => {
    expect(Rivalry.parse(rivalry)).toEqual(rivalry);
  });

  test("currentPick is optional and limited to the two sides", () => {
    const { currentPick: _omitted, ...noPick } = rivalry;
    expect(Rivalry.parse(noPick).currentPick).toBeUndefined();
    expect(Rivalry.parse({ ...rivalry, currentPick: "rival" }).currentPick).toBe("rival");
    expect(Rivalry.safeParse({ ...rivalry, currentPick: "both" }).success).toBe(false);
  });

  test("weekStart is a UTC calendar day, not an ISO instant", () => {
    expect(Rivalry.parse(rivalry).weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${rivalry.weekStart}T00:00:00.000Z`).getUTCDay()).toBe(1);
  });

  test("RivalriesResponse wraps rivalries with a count", () => {
    const payload = { rivalries: [rivalry], count: 1 };
    expect(RivalriesResponse.parse(payload)).toEqual(payload);
    expect(RivalriesResponse.parse({ rivalries: [], count: 0 }).rivalries).toEqual([]);
  });

  test("CreateRivalryRequest leaves rivalTicker optional so the server picks a comparable", () => {
    expect(CreateRivalryRequest.parse({ ticker: "NVDA" }).rivalTicker).toBeUndefined();
    expect(CreateRivalryRequest.parse({ ticker: "NVDA", rivalTicker: "AMD" }).rivalTicker).toBe(
      "AMD",
    );
    expect(CreateRivalryRequest.safeParse({ rivalTicker: "AMD" }).success).toBe(false);
  });
});

describe("DemandPulseBuyer / DemandPulse", () => {
  const buyer = {
    ticker: "MSFT",
    name: "Microsoft Corporation",
    revenueYoY: 14.2,
    capexYoY: 61.8,
    weight: 0.42,
  };

  const pulse = {
    ticker: "NVDA",
    buyers: [buyer],
    pulse: 38.0,
    interpretation: "expanding" as const,
    generatedAt: "2026-08-19T12:00:00.000Z",
    sources: [source],
  };

  test("parses a fully resolved buyer", () => {
    expect(DemandPulseBuyer.parse(buyer)).toEqual(buyer);
  });

  test("an unresolved fundamental is omitted, never zero-filled (AGENTS.md §2.4)", () => {
    const thin = DemandPulseBuyer.parse({ ticker: "PRIVATECO", weight: 0.1 });
    expect(thin.revenueYoY).toBeUndefined();
    expect(thin.capexYoY).toBeUndefined();
    expect(thin.name).toBeUndefined();
  });

  test("buyer weight is validated to 0..1", () => {
    expect(DemandPulseBuyer.safeParse({ ...buyer, weight: 1.2 }).success).toBe(false);
    expect(DemandPulseBuyer.safeParse({ ...buyer, weight: -0.01 }).success).toBe(false);
  });

  test("parses a pulse with cited buyer series", () => {
    expect(DemandPulse.parse(pulse)).toEqual(pulse);
  });

  test("pulse is null (not 0) when no buyer fundamentals resolved", () => {
    const unknown = DemandPulse.parse({
      ...pulse,
      buyers: [],
      pulse: null,
      interpretation: "unknown",
      sources: [],
    });
    expect(unknown.pulse).toBeNull();
    expect(unknown.interpretation).toBe("unknown");
    expect(DemandPulse.safeParse({ ...pulse, pulse: undefined }).success).toBe(false);
  });

  test("interpretation is a closed set", () => {
    for (const value of ["expanding", "contracting", "mixed", "unknown"]) {
      expect(DemandPulse.safeParse({ ...pulse, interpretation: value }).success).toBe(true);
    }
    expect(DemandPulse.safeParse({ ...pulse, interpretation: "bullish" }).success).toBe(false);
  });

  test("requires a sources array (AGENTS.md §6)", () => {
    const { sources: _omitted, ...noSources } = pulse;
    expect(DemandPulse.safeParse(noSources).success).toBe(false);
  });
});

describe("EnvironmentSeries / EnvironmentBrief", () => {
  const series = {
    id: "FEDFUNDS",
    label: "Effective Federal Funds Rate",
    latest: 3.75,
    unit: "percent",
    asOf: "2026-07-01",
  };

  const brief = {
    sector: "Consumer Staples",
    headline: "Input costs cooling, shelf-price elasticity still biting",
    body: "## Environment\n\nRates have eased...",
    tailwinds: ["Freight and packaging deflation"],
    headwinds: ["Trade-down to private label"],
    series: [series],
    generatedAt: "2026-08-19T12:00:00.000Z",
    sources: [source],
  };

  test("parses a cited macro series", () => {
    expect(EnvironmentSeries.parse(series)).toEqual(series);
  });

  test("unit is optional (an index series carries no unit label)", () => {
    const { unit: _omitted, ...noUnit } = series;
    expect(EnvironmentSeries.parse(noUnit).unit).toBeUndefined();
  });

  test("a series with no observation cannot be represented without `latest`/`asOf`", () => {
    const { latest: _l, ...noLatest } = series;
    const { asOf: _a, ...noAsOf } = series;
    expect(EnvironmentSeries.safeParse(noLatest).success).toBe(false);
    expect(EnvironmentSeries.safeParse(noAsOf).success).toBe(false);
  });

  test("parses a sector brief with tailwinds, headwinds, and series", () => {
    expect(EnvironmentBrief.parse(brief)).toEqual(brief);
  });

  test("tailwinds/headwinds/series are required arrays and may be empty", () => {
    const bare = EnvironmentBrief.parse({
      ...brief,
      tailwinds: [],
      headwinds: [],
      series: [],
      sources: [],
    });
    expect(bare.tailwinds).toEqual([]);
    expect(bare.series).toEqual([]);
    const { tailwinds: _omitted, ...noTailwinds } = brief;
    expect(EnvironmentBrief.safeParse(noTailwinds).success).toBe(false);
  });

  test("requires a sources array (AGENTS.md §6)", () => {
    const { sources: _omitted, ...noSources } = brief;
    expect(EnvironmentBrief.safeParse(noSources).success).toBe(false);
  });
});

describe("SynthesisMemoResponse", () => {
  const memo = {
    ticker: "NVDA",
    memo: "## Synthesis\n\nThe binding constraint is advanced packaging capacity...",
    bindingConstraint: "CoWoS advanced packaging capacity at the foundry.",
    demandDurability: "Hyperscaler capex guidance underwrites two more quarters.",
    pricingPower: "Concentrated at the accelerator layer, not the board partners.",
    generatedAt: "2026-08-19T12:00:00.000Z",
    sources: [source],
  };

  test("parses a fully layered memo", () => {
    expect(SynthesisMemoResponse.parse(memo)).toEqual(memo);
  });

  test("degrades to a plain memo: layer answers are omitted, never guessed", () => {
    const { bindingConstraint: _b, demandDurability: _d, pricingPower: _p, ...plain } = memo;
    const parsed = SynthesisMemoResponse.parse({ ...plain, sources: [] });
    expect(parsed.memo).toBe(memo.memo);
    expect(parsed.bindingConstraint).toBeUndefined();
    expect(parsed.demandDurability).toBeUndefined();
    expect(parsed.pricingPower).toBeUndefined();
    expect(parsed.sources).toEqual([]);
  });

  test("memo text and ticker are required", () => {
    const { memo: _omitted, ...noMemo } = memo;
    expect(SynthesisMemoResponse.safeParse(noMemo).success).toBe(false);
  });

  test("requires a sources array (AGENTS.md §6)", () => {
    const { sources: _omitted, ...noSources } = memo;
    expect(SynthesisMemoResponse.safeParse(noSources).success).toBe(false);
  });
});
