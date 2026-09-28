import { describe, expect, test } from "bun:test";
import {
  MCP_QUESTION_MAX_CHARS,
  MCP_TEXT_MAX_CHARS,
  MCP_TICKER_MAX_CHARS,
  McpAskLatticeArgs,
  McpBrandLookupArgs,
  McpBrandLookupResult,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpManifest,
  McpRatingArgs,
  McpRatingResult,
  McpSearchIntentArgs,
  McpSearchIntentResult,
  RATING_DISCLAIMER,
  RatingResponse,
} from "../src/schemas/index.js";

/**
 * Offline wire-shape tests for the Mapvest MCP tools (apps/api/src/lib/
 * mcp-tools.ts). The server parses arguments with these and parses its own
 * result before it sends it, so these pin what a caller may send and read.
 */

describe("tool arguments", () => {
  test("are trimmed, bounded, and strict: a stray key is refused, never ignored", () => {
    expect(McpSearchIntentArgs.parse({ query: "  starbucks  " })).toEqual({ query: "starbucks" });
    expect(McpBrandLookupArgs.parse({ brand: " nike " })).toEqual({ brand: "nike" });
    expect(McpRatingArgs.parse({ ticker: " mcd " })).toEqual({ ticker: "mcd" });
    expect(McpAskLatticeArgs.parse({ question: " hi ", to: "app" })).toEqual({
      question: "hi",
      to: "app",
    });

    for (const [schema, key, max] of [
      [McpSearchIntentArgs, "query", MCP_TEXT_MAX_CHARS],
      [McpBrandLookupArgs, "brand", MCP_TEXT_MAX_CHARS],
      [McpRatingArgs, "ticker", MCP_TICKER_MAX_CHARS],
      [McpAskLatticeArgs, "question", MCP_QUESTION_MAX_CHARS],
    ] as const) {
      expect(schema.safeParse({ [key]: "x".repeat(max) }).success).toBe(true);
      expect(schema.safeParse({ [key]: "x".repeat(max + 1) }).success).toBe(false);
      expect(schema.safeParse({ [key]: "   " }).success).toBe(false);
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse({ [key]: "x", url: "https://evil.example" }).success).toBe(false);
      expect(schema.safeParse({ [key]: "x", userId: "u_1" }).success).toBe(false);
    }
    expect(McpAskLatticeArgs.safeParse({ question: "hi", to: "everyone" }).success).toBe(false);
  });

  test("the bounds are the ones the REST search box already has", () => {
    expect(MCP_TEXT_MAX_CHARS).toBe(200);
    expect(MCP_QUESTION_MAX_CHARS).toBe(600);
  });
});

describe("search_intent result", () => {
  const seedHit: McpSearchIntentResult = {
    query: "burger king",
    intent: "brand",
    probability: 0.95,
    method: "deterministic",
    resolved: { brand: "burger king", symbol: "QSR" },
    sources: [{ provider: "manual", fetchedAt: "2026-09-28T12:00:00.000Z", confidence: "high" }],
    confidence: "high",
  };

  test("carries sources and a confidence, and no app-navigation route", () => {
    const parsed = McpSearchIntentResult.parse({
      ...seedHit,
      route: { screen: "detail", params: { id: "QSR" } },
    });
    expect(parsed).toEqual(seedHit);
    expect("route" in parsed).toBe(false);
  });

  test("an uncited reading is expressible as empty sources and low, with a note", () => {
    const parsed = McpSearchIntentResult.parse({
      query: "$NVDA",
      intent: "ticker",
      probability: 0.97,
      method: "deterministic",
      resolved: { symbol: "NVDA" },
      sources: [],
      confidence: "low",
      note: "Nothing is cited for this reading.",
    });
    expect(parsed.sources).toEqual([]);
    expect(parsed.confidence).toBe("low");
  });

  test("refuses a missing sources array, an unknown confidence, and an unknown method", () => {
    const { sources: _sources, ...noSources } = seedHit;
    expect(McpSearchIntentResult.safeParse(noSources).success).toBe(false);
    expect(McpSearchIntentResult.safeParse({ ...seedHit, confidence: "certain" }).success).toBe(
      false,
    );
    expect(McpSearchIntentResult.safeParse({ ...seedHit, method: "guess" }).success).toBe(false);
    expect(McpSearchIntentResult.safeParse({ ...seedHit, probability: 1.5 }).success).toBe(false);
  });
});

describe("brand_lookup result", () => {
  test("a hit names the seed key, and a miss is found: false with no match and no source", () => {
    const hit = McpBrandLookupResult.parse({
      query: "McDonald's",
      found: true,
      match: {
        kind: "exact",
        key: "mcdonald's",
        ticker: "MCD",
        exchange: "NYSE",
        parent: "McDonald's Corp",
        sector: "Consumer Discretionary",
      },
      sources: [{ provider: "manual", fetchedAt: "2026-09-28T12:00:00.000Z", confidence: "high" }],
      confidence: "high",
    });
    expect(hit.match?.ticker).toBe("MCD");

    const miss = McpBrandLookupResult.parse({
      query: "zzzz",
      found: false,
      match: null,
      sources: [],
      confidence: "low",
      note: "Not in the curated brand seed.",
    });
    expect(miss.match).toBeNull();
    expect(
      McpBrandLookupResult.safeParse({ ...miss, match: { ...hit.match, kind: "fuzzy" } }).success,
    ).toBe(false);
  });
});

describe("rating result", () => {
  const rating: McpRatingResult = {
    ticker: "MCD",
    status: "insufficient_signal",
    rating: null,
    probabilities: null,
    confidence: 0,
    drivers: [],
    evidence: [],
    inputs_used: [],
    as_of: "2026-09-28T12:00:00.000Z",
    disclaimer: RATING_DISCLAIMER,
  };

  test("is the REST RatingResponse plus an optional note, so a route body still parses", () => {
    expect(RatingResponse.safeParse(rating).success).toBe(true);
    expect(McpRatingResult.parse(rating)).toEqual(rating);
    expect(McpRatingResult.parse({ ...rating, note: "No rating was produced." }).note).toBe(
      "No rating was produced.",
    );
    expect(McpRatingResult.safeParse({ ...rating, disclaimer: undefined }).success).toBe(false);
    expect(McpRatingResult.safeParse({ ...rating, status: "hold" }).success).toBe(false);
  });
});

describe("JSON-RPC and the manifest", () => {
  test("a request may omit its id (a notification); a response carries a result or an error", () => {
    expect(
      McpJsonRpcRequest.safeParse({ jsonrpc: "2.0", method: "notifications/initialized" }).success,
    ).toBe(true);
    expect(McpJsonRpcRequest.safeParse({ jsonrpc: "1.0", id: 1, method: "ping" }).success).toBe(
      false,
    );
    expect(McpJsonRpcResponse.safeParse({ jsonrpc: "2.0", id: 1, result: {} }).success).toBe(true);
    expect(
      McpJsonRpcResponse.safeParse({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "invalid request" },
      }).success,
    ).toBe(true);
  });

  test("the manifest is the one mcp-lite builds: streamable-http, stateless, no auth", () => {
    const manifest: McpManifest = {
      name: "mapvest",
      title: "Mapvest",
      description: "",
      version: "0.1.0",
      endpoint: "https://api-production-4b27.up.railway.app/mcp",
      transport: "streamable-http",
      stateless: true,
      auth: "none",
      protocolVersions: ["2025-11-25"],
      tools: [{ name: "rating", description: "d", readOnly: true }],
      peers: [
        {
          name: "lattice",
          endpoint: "https://api-production-4b27.up.railway.app/mcp/lattice",
          about: "",
        },
      ],
      hop: { max: 2, headers: ["x-mcp-hop", "x-mcp-path"] },
    };
    expect(McpManifest.parse(manifest)).toEqual(manifest);
    expect(McpManifest.safeParse({ ...manifest, auth: "bearer" }).success).toBe(false);
    expect(McpManifest.safeParse({ ...manifest, endpoint: "not a url" }).success).toBe(false);
  });
});
