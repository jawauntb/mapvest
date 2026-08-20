import { describe, expect, test } from "bun:test";
import {
  CompanyEdge,
  CompanyEdgeType,
  CompanyGraphResponse,
  DexRarity,
  DexResponse,
  DexSector,
  ProgressResponse,
  UniverseSummary,
  UserProgress,
} from "../src/schemas/index.js";

/**
 * Offline-only wire-shape tests for the Universe Roadmap slices (A1/A3/A4/C1).
 * Downstream agents build routes and stores against these exact shapes, so the
 * assertions below pin field names, optionality, and the AGENTS.md §6
 * `sources: Source[]` requirement rather than any runtime behavior.
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
    updatedAt: "2026-08-19T12:00:00.000Z",
  };

  test("parses a full progression row", () => {
    expect(UserProgress.parse(progress)).toEqual(progress);
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

  test("DexResponse parses sectors plus regional tiles", () => {
    const dex = {
      sectors: [
        { sector: "Consumer Staples", found: 14, total: 89 },
        { sector: "Technology", found: 3, total: 61 },
      ],
      tilesVisited: 8,
      totalFinds: 17,
    };
    expect(DexResponse.parse(dex)).toEqual(dex);
  });

  test("rejects a sector row missing `total`", () => {
    expect(
      DexResponse.safeParse({
        sectors: [{ sector: "Technology", found: 3 }],
        tilesVisited: 1,
        totalFinds: 3,
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
