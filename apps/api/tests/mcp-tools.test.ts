import { afterEach, beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import {
  MCP_QUESTION_MAX_CHARS,
  MCP_TEXT_MAX_CHARS,
  MCP_TICKER_MAX_CHARS,
  McpAskLatticeArgs,
  McpBrandLookupArgs,
  McpBrandLookupResult,
  McpManifest,
  McpRatingArgs,
  McpRatingResult,
  McpSearchIntentArgs,
  McpSearchIntentResult,
  RATING_DISCLAIMER,
  type RatingResponse,
} from "@mapvest/core";
import type { JevAnswer, JevBatchResult } from "../src/lib/jev-client.js";
import { HUB_URL, type Mcp, type Post, type PostResult } from "../src/lib/mcp-lite.mjs";
import {
  MCP_DEFAULT_ORIGIN,
  MCP_IDLE_TIMEOUT_S,
  MCP_TOOL_DEADLINE_MS,
  type McpToolDeps,
  WITHHELD_SUMMARY,
  buildMapvestMcp,
} from "../src/lib/mcp-tools.js";
import { _clearRatingCache } from "../src/lib/rating.js";
import { _clearSearchIntentCache, resolveSearchIntent } from "../src/lib/search-intent.js";

/**
 * The Mapvest MCP tools (lib/mcp-tools.ts), driven through `mcp.handle` so the
 * arguments travel the same path a caller's do. The wrapped functions are
 * injected or the network is stubbed away: nothing here reaches a provider,
 * Jev, or another site, and no key is needed.
 */

const originalFetch = globalThis.fetch;
const originalJevKey = process.env.JEV_API_KEY;

function offline(): { calls: number } {
  const seen = { calls: 0 };
  globalThis.fetch = (async () => {
    seen.calls += 1;
    throw new Error("offline");
  }) as unknown as typeof fetch;
  return seen;
}

// An env var is unset by deleting it: assigning `undefined` stores the string "undefined".
const setJevKey = (value: string | undefined) => {
  if (value === undefined) Reflect.deleteProperty(process.env, "JEV_API_KEY");
  else process.env.JEV_API_KEY = value;
};

beforeEach(() => {
  _clearSearchIntentCache();
  _clearRatingCache();
  setJevKey(undefined);
  // Fail closed: a test that reaches for the network fails instead of going out.
  // Tests that count calls take a fresh counter from `offline()` themselves.
  offline();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  setJevKey(originalJevKey);
});

// ---------------- harness ----------------

type RpcJson = {
  result?: { content?: Array<{ text?: string }>; isError?: boolean; _meta?: unknown };
  error?: { code: number; message: string };
};

async function callTool(
  mcp: Mcp,
  name: string,
  args?: unknown,
  headers: Record<string, string> = {},
) {
  const out = await mcp.handle({
    method: "POST",
    path: "/mcp",
    headers,
    ip: "",
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, ...(args === undefined ? {} : { arguments: args }) },
    },
  });
  const json = out?.json as RpcJson | null | undefined;
  return {
    status: out?.status,
    error: json?.error,
    isError: json?.result?.isError === true,
    text: json?.result?.content?.[0]?.text ?? "",
    result: json?.result,
  };
}

const build = (deps: Partial<McpToolDeps> = {}, post?: Post) =>
  buildMapvestMcp({ env: {}, deps, ...(post ? { post } : {}) });

const NEVER = () => new Promise<never>(() => {});

const NOW = "2026-09-28T12:00:00.000Z";

function okRating(over: Partial<RatingResponse> = {}): RatingResponse {
  return {
    ticker: "MCD",
    status: "ok",
    rating: {
      action: "buy",
      strength: "normal",
      conviction: 0.72,
      one_line: "Buy · momentum + fundamentals; macro headwind",
    },
    probabilities: { strong_sell: 0.02, sell: 0.06, hold: 0.2, buy: 0.5, strong_buy: 0.22 },
    confidence: 0.72,
    drivers: [
      { name: "momentum", direction: "up", weight: 0.6 },
      { name: "fundamentals", direction: "up", weight: 0.4 },
      { name: "macro", direction: "down", weight: 0.3 },
    ],
    evidence: [
      {
        source: "quote",
        summary: "Price $301.55 (+1.2% today); 1m +4.0%, 3m +9.1%, 2.0% below 3-month high",
      },
      { source: "ratios", summary: "P/E 24.1, P/S 8.3, EV/EBITDA 17.9, ROE 0%, D/E 1.4" },
      {
        source: "prism",
        summary: "Prism: buy (normal), conviction 62%; bull 41% / bear 21%; regime risk-on",
        ref: "https://underlying-terminal-production.up.railway.app/api/prism/MCD/summary",
      },
      {
        source: "headlines",
        summary: "Franchisee margins squeezed by wage costs",
        ref: "/v1/news?ticker=MCD&materiality=material",
      },
    ],
    inputs_used: ["quote", "ratios", "prism", "headlines"],
    as_of: NOW,
    disclaimer: RATING_DISCLAIMER,
    ...over,
  };
}

// ---------------- search_intent ----------------

describe("search_intent", () => {
  // A listing probe that also carries a price, to prove the price never leaves.
  const listedHit = {
    provider: "massive",
    ts: "2026-09-28T15:00:00.000Z",
    price: 123456.78,
  } as const;
  const quote = async (symbol: string) => (symbol === "NVDA" ? listedHit : null);

  test("a seeded brand answers with its ticker and cites the seed", async () => {
    const r = await callTool(build({ quote }), "search_intent", { query: "burger king" });
    expect(r.isError).toBe(false);
    const raw = JSON.parse(r.text) as Record<string, unknown>;
    const body = McpSearchIntentResult.parse(raw);
    expect(body).toMatchObject({
      query: "burger king",
      intent: "brand",
      method: "deterministic",
      probability: 0.95,
      resolved: { brand: "burger king", symbol: "QSR" },
      confidence: "high",
    });
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0]).toMatchObject({ provider: "manual", confidence: "high" });
    expect(body.note).toBeUndefined();
    expect("route" in raw).toBe(false);
  });

  test("a seed name inside longer text is a medium reading with a medium source", async () => {
    const r = await callTool(build({ quote }), "search_intent", {
      query: "burger king drive thru",
    });
    const body = McpSearchIntentResult.parse(JSON.parse(r.text));
    expect(body).toMatchObject({ intent: "brand", probability: 0.8, confidence: "medium" });
    expect(body.resolved.symbol).toBe("QSR");
    expect(body.sources[0]).toMatchObject({ provider: "manual", confidence: "medium" });
  });

  test("a typed ticker confirmed listed cites the provider that confirmed it, never a price", async () => {
    const mcp = build({ quote });
    const first = await callTool(mcp, "search_intent", { query: "nvda" });
    const body = McpSearchIntentResult.parse(JSON.parse(first.text));
    expect(body).toMatchObject({
      intent: "ticker",
      method: "deterministic",
      resolved: { symbol: "NVDA" },
      confidence: "high",
    });
    expect(body.sources).toEqual([
      { provider: "massive", fetchedAt: listedHit.ts, confidence: "high" },
    ]);
    expect(first.text).not.toContain("123456");

    // The resolver memoizes the reading; the citation must not disappear with the probe.
    const second = await callTool(mcp, "search_intent", { query: " NVDA " });
    expect(McpSearchIntentResult.parse(JSON.parse(second.text)).sources).toEqual(body.sources);
  });

  test("a cashtag is only the shape of a ticker: no source, confidence low, and it says so", async () => {
    const r = await callTool(build({ quote }), "search_intent", { query: "$NVDA" });
    const body = McpSearchIntentResult.parse(JSON.parse(r.text));
    expect(body).toMatchObject({
      intent: "ticker",
      probability: 0.97,
      sources: [],
      confidence: "low",
    });
    expect(body.note).toContain("Nothing is cited");
  });

  test("a question and a place need no source and are read at their probability", async () => {
    const mcp = build({ quote });
    const question = McpSearchIntentResult.parse(
      JSON.parse((await callTool(mcp, "search_intent", { query: "what does nvidia sell?" })).text),
    );
    expect(question).toMatchObject({ intent: "question", confidence: "high", sources: [] });
    expect(question.note).toBeUndefined();

    const place = McpSearchIntentResult.parse(
      JSON.parse((await callTool(mcp, "search_intent", { query: "starbucks near me" })).text),
    );
    expect(place).toMatchObject({ intent: "place", confidence: "high", sources: [] });
  });

  test("a text no rule reads and no classifier is asked about falls open, and says it is a guess", async () => {
    const r = await callTool(build({ quote }), "search_intent", { query: "quorvex" });
    const body = McpSearchIntentResult.parse(JSON.parse(r.text));
    expect(body).toMatchObject({
      intent: "ticker",
      method: "fallback",
      probability: 0.5,
      sources: [],
      confidence: "low",
    });
    expect(body.note).toContain("No decision was made");
  });

  test("the classifier's reading is passed on: a brand it names that the seed lacks has no ticker", async () => {
    setJevKey("test-jev-key");
    const ask = async (): Promise<JevBatchResult> => ({
      ok: true,
      answers: {
        intent: {
          type: "choice",
          choice: "brand",
          probabilities: { brand: 0.9 },
          confidence: 0.9,
        } satisfies JevAnswer,
      },
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const mcp = build({
      quote,
      resolveSearchIntent: (input, deps) => resolveSearchIntent(input, { ...deps, ask }),
    });
    const body = McpSearchIntentResult.parse(
      JSON.parse((await callTool(mcp, "search_intent", { query: "kith" })).text),
    );
    expect(body).toMatchObject({ intent: "brand", method: "jev", sources: [], confidence: "low" });
    expect(body.resolved.symbol).toBeUndefined();
    expect(body.note).toContain("not in the curated seed");
  });

  test("a confident classifier reading of a place is high: there is no claim to cite", async () => {
    setJevKey("test-jev-key");
    const ask = async (): Promise<JevBatchResult> => ({
      ok: true,
      answers: {
        intent: {
          type: "choice",
          choice: "place",
          probabilities: { place: 0.92 },
          confidence: 0.92,
        } satisfies JevAnswer,
      },
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const mcp = build({
      quote,
      resolveSearchIntent: (input, deps) => resolveSearchIntent(input, { ...deps, ask }),
    });
    const body = McpSearchIntentResult.parse(
      JSON.parse((await callTool(mcp, "search_intent", { query: "the west village" })).text),
    );
    expect(body).toMatchObject({ intent: "place", method: "jev", confidence: "high" });
  });

  test("bad arguments are refused before anything runs, and the value is never echoed", async () => {
    const calls: string[] = [];
    const mcp = build({
      resolveSearchIntent: async (input) => {
        calls.push(input.q);
        return {
          intent: "question",
          probability: 0.9,
          resolved: {},
          route: { screen: "research", params: {} },
          method: "deterministic",
        };
      },
    });
    const secret = "sk-not-a-real-key-but-do-not-echo-me";
    const bad: unknown[] = [
      {},
      { query: "" },
      { query: "   " },
      { query: 5 },
      { query: "x".repeat(MCP_TEXT_MAX_CHARS + 1) },
      { query: secret, url: "https://evil.example/" },
      { query: "nike", lat: 40.7, lng: -73.9 },
      { query: "nike", userId: "u_1" },
    ];
    for (const args of bad) {
      const r = await callTool(mcp, "search_intent", args);
      expect(r.isError).toBe(true);
      expect(r.text).toStartWith("invalid arguments for search_intent:");
      expect(r.text).not.toContain(secret);
      expect(r.text.length).toBeLessThanOrEqual(300);
    }
    const noArgs = await callTool(mcp, "search_intent");
    expect(noArgs.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  test("the longest allowed text is read", async () => {
    const seen: string[] = [];
    const mcp = build({
      resolveSearchIntent: async (input) => {
        seen.push(input.q);
        return {
          intent: "question",
          probability: 0.9,
          resolved: {},
          route: { screen: "research", params: {} },
          method: "deterministic",
        };
      },
    });
    const r = await callTool(mcp, "search_intent", { query: "a".repeat(MCP_TEXT_MAX_CHARS) });
    expect(r.isError).toBe(false);
    expect(seen[0]).toHaveLength(MCP_TEXT_MAX_CHARS);
  });

  test("a resolver that outlasts the deadline is an error result, not a hung call", async () => {
    const mcp = build({ resolveSearchIntent: NEVER, deadlineMs: 20 });
    const started = Date.now();
    const r = await callTool(mcp, "search_intent", { query: "anything" });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(r.isError).toBe(true);
    expect(r.text).toContain("did not finish");
  });

  test("a resolver that throws fails closed with the library's plain message", async () => {
    const mcp = build({
      resolveSearchIntent: async () => {
        throw new Error("boom: secret internals");
      },
    });
    const r = await callTool(mcp, "search_intent", { query: "anything" });
    expect(r.isError).toBe(true);
    expect(r.text).toBe("the tool failed");
  });

  test("the whole path runs offline through the real resolver", async () => {
    const net = offline();
    const r = await callTool(build(), "search_intent", { query: "what is a lattice animal?" });
    expect(McpSearchIntentResult.parse(JSON.parse(r.text)).intent).toBe("question");
    expect(net.calls).toBe(0);
  });
});

// ---------------- brand_lookup ----------------

describe("brand_lookup", () => {
  const lookup = async (args: unknown) => {
    const r = await callTool(build(), "brand_lookup", args);
    return { ...r, body: r.isError ? null : McpBrandLookupResult.parse(JSON.parse(r.text)) };
  };

  test("a seed key gives the ticker, exchange, parent and sector, and cites the seed", async () => {
    const { isError, body } = await lookup({ brand: "McDonald's" });
    expect(isError).toBe(false);
    expect(body).toMatchObject({
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
      confidence: "high",
    });
    expect(body?.sources).toHaveLength(1);
    expect(body?.sources[0]).toMatchObject({ provider: "manual", confidence: "high" });
    expect(body?.note).toBeUndefined();
  });

  test("case, spacing and a curly apostrophe fold to the same key", async () => {
    for (const brand of ["  MCDONALDS ", "mcdonald’s", "McDonald's", "MCDONALD'S"]) {
      const { body } = await lookup({ brand });
      expect(body?.match).toMatchObject({ kind: "exact", ticker: "MCD" });
    }
    const spaced = await lookup({ brand: "  Burger \n  KING " });
    expect(spaced.body?.match).toMatchObject({ kind: "exact", key: "burger king", ticker: "QSR" });
    expect(spaced.body?.query).toBe("Burger KING");
  });

  test("a seed name inside longer text is marked contained, confidence medium, with a caution", async () => {
    const { body } = await lookup({ brand: "lunch at burger king today" });
    expect(body).toMatchObject({
      found: true,
      match: { kind: "contained", key: "burger king", ticker: "QSR" },
      confidence: "medium",
    });
    expect(body?.sources[0]).toMatchObject({ provider: "manual", confidence: "medium" });
    expect(body?.note).toContain("check it is the brand you meant");
  });

  test("a brand the seed lacks is found: false, uncited, low, and not called private", async () => {
    const { body } = await lookup({ brand: "zzzz unknown brand" });
    expect(body).toMatchObject({
      found: false,
      match: null,
      sources: [],
      confidence: "low",
    });
    expect(body?.note).toContain("does not mean the brand is private or unlisted");
  });

  test("it never touches the network", async () => {
    const net = offline();
    await lookup({ brand: "nike" });
    await lookup({ brand: "not a real brand" });
    expect(net.calls).toBe(0);
  });

  test("bad arguments are refused", async () => {
    const bad: unknown[] = [
      {},
      { brand: "" },
      { brand: "  " },
      { brand: 7 },
      { brand: "b".repeat(MCP_TEXT_MAX_CHARS + 1) },
      { brand: "nike", url: "https://evil.example/" },
      { ticker: "NKE" },
    ];
    for (const args of bad) {
      const r = await callTool(build(), "brand_lookup", args);
      expect(r.isError).toBe(true);
      expect(r.text).toStartWith("invalid arguments for brand_lookup:");
    }
  });
});

// ---------------- rating ----------------

describe("rating", () => {
  test("an ok rating passes through with its disclaimer verbatim", async () => {
    const asked: string[] = [];
    const mcp = build({
      readRatingCache: () => null,
      buildRating: async (t) => {
        asked.push(t);
        return okRating();
      },
    });
    const r = await callTool(mcp, "rating", { ticker: "MCD" });
    expect(r.isError).toBe(false);
    const body = McpRatingResult.parse(JSON.parse(r.text));
    expect(asked).toEqual(["MCD"]);
    expect(body.status).toBe("ok");
    expect(body.rating).toEqual({
      action: "buy",
      strength: "normal",
      conviction: 0.72,
      one_line: "Buy · momentum + fundamentals; macro headwind",
    });
    expect(body.disclaimer).toBe("AI-generated research signal, not investment advice.");
    expect(body.disclaimer).toBe(RATING_DISCLAIMER);
    expect(body.probabilities?.buy).toBe(0.5);
    expect(body.drivers.map((d) => d.name)).toEqual(["momentum", "fundamentals", "macro"]);
    expect(body.inputs_used).toEqual(["quote", "ratios", "prism", "headlines"]);
  });

  test("evidence that restates licensed market data is listed by name and withheld", async () => {
    const mcp = build({ readRatingCache: () => null, buildRating: async () => okRating() });
    const r = await callTool(mcp, "rating", { ticker: "MCD" });
    const body = McpRatingResult.parse(JSON.parse(r.text));
    const bySource = Object.fromEntries(body.evidence.map((e) => [e.source, e]));
    expect(bySource.quote?.summary).toBe(WITHHELD_SUMMARY);
    expect(bySource.ratios?.summary).toBe(WITHHELD_SUMMARY);
    expect(bySource.quote?.ref).toBeUndefined();
    // Not a figure from either survives anywhere in the result.
    for (const figure of ["301.55", "+1.2%", "P/E", "24.1", "EV/EBITDA", "3-month high"]) {
      expect(r.text).not.toContain(figure);
    }
    // The other evidence is kept as the route returns it.
    expect(bySource.prism?.summary).toContain("Prism: buy (normal)");
    expect(bySource.prism?.ref).toContain("/api/prism/MCD/summary");
    expect(bySource.headlines?.ref).toBe("/v1/news?ticker=MCD&materiality=material");
    expect(body.note).toContain("licensed market data");
  });

  test("insufficient_signal is passed through as no rating, never as a hold", async () => {
    const insufficient = okRating({
      status: "insufficient_signal",
      rating: null,
      probabilities: null,
      confidence: 0,
      drivers: [],
      evidence: [],
      inputs_used: [],
    });
    const mcp = build({ readRatingCache: () => null, buildRating: async () => insufficient });
    const r = await callTool(mcp, "rating", { ticker: "MCD" });
    expect(r.isError).toBe(false);
    const body = McpRatingResult.parse(JSON.parse(r.text));
    expect(body).toMatchObject({
      status: "insufficient_signal",
      rating: null,
      probabilities: null,
      confidence: 0,
    });
    expect(body.disclaimer).toBe(RATING_DISCLAIMER);
    expect(body.note).toContain("not a hold");
    expect(r.text).not.toContain('"action":"hold"');
  });

  test("with no keys and no network the real rating is insufficient_signal, honestly", async () => {
    const net = offline();
    const r = await callTool(build(), "rating", { ticker: "zzzq" });
    expect(r.isError).toBe(false);
    const body = McpRatingResult.parse(JSON.parse(r.text));
    expect(body).toMatchObject({
      ticker: "ZZZQ",
      status: "insufficient_signal",
      rating: null,
      probabilities: null,
      confidence: 0,
      disclaimer: RATING_DISCLAIMER,
    });
    expect(net.calls).toBeGreaterThan(0);
  });

  test("a leading $ and the case are folded before the ticker is checked", async () => {
    const asked: string[] = [];
    const mcp = build({
      readRatingCache: () => null,
      buildRating: async (t) => {
        asked.push(t);
        return okRating({ ticker: t });
      },
    });
    for (const ticker of ["$mcd", " brk.b ", "NVDA"]) {
      expect((await callTool(mcp, "rating", { ticker })).isError).toBe(false);
    }
    expect(asked).toEqual(["MCD", "BRK.B", "NVDA"]);
  });

  test("a bad ticker or a stray key is refused and nothing is computed", async () => {
    const asked: string[] = [];
    const mcp = build({
      readRatingCache: () => null,
      buildRating: async (t) => {
        asked.push(t);
        return okRating();
      },
    });
    const bad: unknown[] = [
      {},
      { ticker: "" },
      { ticker: "   " },
      { ticker: 123 },
      { ticker: "123" },
      { ticker: "not a ticker" },
      { ticker: "MC D" },
      { ticker: "$" },
      { ticker: "$$MCD" },
      { ticker: "mcd!" },
      { ticker: "T".repeat(MCP_TICKER_MAX_CHARS + 1) },
      { ticker: "TOOLONGX" },
      { ticker: "MCD", url: "https://evil.example/" },
      { ticker: "MCD", userId: "u_1" },
    ];
    for (const args of bad) {
      const r = await callTool(mcp, "rating", args);
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/^invalid (arguments for rating|ticker)/);
    }
    expect(asked).toEqual([]);
  });

  test("a rating that outlasts the deadline is an error result, and its computation is left to finish", async () => {
    const mcp = build({ readRatingCache: () => null, buildRating: NEVER, deadlineMs: 20 });
    const started = Date.now();
    const r = await callTool(mcp, "rating", { ticker: "MCD" });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(r.isError).toBe(true);
    expect(r.text).toContain("did not finish");
    expect(r.text).toContain("cached once done");
  });

  test("the quick tools keep their own 7 s budget, well inside the server's idle timeout", () => {
    expect(MCP_TOOL_DEADLINE_MS).toBe(7_000);
    expect(MCP_TOOL_DEADLINE_MS).toBeLessThan(MCP_IDLE_TIMEOUT_S * 1_000);
  });

  test("the idle timeout is well above Bun's 10 s default and the animals' slowest answers", () => {
    expect(MCP_IDLE_TIMEOUT_S).toBeGreaterThan(20);
    expect(MCP_IDLE_TIMEOUT_S).toBe(30);
  });

  test("fresh ratings are capped per UTC day; a cached one is free and the day resets the cap", async () => {
    let clock = Date.UTC(2026, 8, 28, 12);
    const cache = new Set<string>();
    const computed: string[] = [];
    const mcp = build({
      now: () => clock,
      ratingDailyCap: 2,
      readRatingCache: (t) => (cache.has(t) ? okRating({ ticker: t }) : null),
      // Like the real one: a ticker already in the cache is answered from it, not computed.
      buildRating: async (t) => {
        if (!cache.has(t)) {
          cache.add(t);
          computed.push(t);
        }
        return okRating({ ticker: t });
      },
    });
    expect((await callTool(mcp, "rating", { ticker: "AAA" })).isError).toBe(false);
    expect((await callTool(mcp, "rating", { ticker: "BBB" })).isError).toBe(false);
    const over = await callTool(mcp, "rating", { ticker: "CCC" });
    expect(over.isError).toBe(true);
    expect(over.text).toContain("rating budget for today is used");
    expect(computed).toEqual(["AAA", "BBB"]);

    // A rating computed in the last hour is still served once the budget is gone.
    expect((await callTool(mcp, "rating", { ticker: "AAA" })).isError).toBe(false);
    expect(computed).toEqual(["AAA", "BBB"]);

    clock = Date.UTC(2026, 8, 29, 0, 0, 1);
    expect((await callTool(mcp, "rating", { ticker: "CCC" })).isError).toBe(false);
    expect(computed).toEqual(["AAA", "BBB", "CCC"]);
  });

  test("the worst-case result fits in the library's 8000-character clip whole", async () => {
    const sources = [
      "quote",
      "ratios",
      "synthesis_memo",
      "demand_pulse",
      "environment_brief",
      "prism",
      "situate",
      "headlines",
      "peer_forecast",
    ];
    const big = okRating({
      drivers: [
        "valuation",
        "momentum",
        "fundamentals",
        "narrative",
        "macro",
        "local_demand",
        "peer_forecast",
      ].map((name) => ({ name, direction: "up", weight: 0.99 })) as RatingResponse["drivers"],
      evidence: sources.map((source) => ({
        source,
        summary: "s".repeat(300),
        ref: `https://underlying-terminal-production.up.railway.app/${"p".repeat(120)}`,
      })),
      inputs_used: sources,
    });
    const mcp = build({ readRatingCache: () => null, buildRating: async () => big });
    const r = await callTool(mcp, "rating", { ticker: "MCD" });
    expect(r.text.length).toBeLessThan(8_000);
    expect(McpRatingResult.parse(JSON.parse(r.text)).evidence).toHaveLength(9);
  });
});

// ---------------- ask_lattice_animals ----------------

describe("ask_lattice_animals", () => {
  type Sent = {
    url: string;
    headers: Record<string, string>;
    timeoutMs: number;
    body: { method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  };

  function hub(text = "the field says hello") {
    const sent: Sent[] = [];
    const post: Post = async (url, { body, headers, timeoutMs }): Promise<PostResult> => {
      const m = JSON.parse(body) as Sent["body"] & { id: number };
      sent.push({ url, headers, timeoutMs, body: m });
      return {
        ok: true,
        status: 200,
        headers: { "content-type": "application/json" },
        text: JSON.stringify({
          jsonrpc: "2.0",
          id: m.id,
          result: { content: [{ type: "text", text }] },
        }),
      };
    };
    return { sent, post };
  }

  test("a question goes to the hub's ask_the_minds one hop deeper, and the answer comes back", async () => {
    const { sent, post } = hub();
    const r = await callTool(build({}, post), "ask_lattice_animals", {
      question: "what are you?",
      to: "app",
    });
    expect(r.isError).toBe(false);
    expect(r.text).toBe("the field says hello");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(HUB_URL);
    expect(sent[0]?.headers["x-mcp-hop"]).toBe("1");
    expect(sent[0]?.headers["x-mcp-path"]).toBe("mapvest");
    expect(sent[0]?.body.params).toEqual({
      name: "ask_the_minds",
      arguments: { question: "what are you?", to: "app" },
    });
    // The wait for the hub is the library's own, not a cap of ours: long enough for the animals
    // (5 to 20 s, past Bun's old 10 s), and shorter than the server's idle timeout so Bun does
    // not close the connection first.
    expect(sent[0]?.timeoutMs).toBeGreaterThan(20_000);
    expect(sent[0]?.timeoutMs).toBeLessThan(MCP_IDLE_TIMEOUT_S * 1_000);
  });

  test("an empty question, a bad addressee or a stray key is refused before anything goes out", async () => {
    const { sent, post } = hub();
    const mcp = build({}, post);
    const bad: unknown[] = [
      {},
      { question: "" },
      { question: "  " },
      { question: "q".repeat(MCP_QUESTION_MAX_CHARS + 1) },
      { question: "hi", to: "everyone" },
      { question: "hi", url: "https://evil.example/mcp" },
      { question: 4 },
    ];
    for (const args of bad) {
      const r = await callTool(mcp, "ask_lattice_animals", args);
      expect(r.isError).toBe(true);
      expect(r.text).toStartWith("invalid arguments for ask_lattice_animals:");
    }
    expect(sent).toEqual([]);
  });

  test("at the hop limit it is refused as too-deep and nothing goes out", async () => {
    const { sent, post } = hub();
    const r = await callTool(
      build({}, post),
      "ask_lattice_animals",
      { question: "hi" },
      {
        "x-mcp-hop": "2",
        "x-mcp-path": "lattice>reflect-search",
      },
    );
    expect(r.isError).toBe(true);
    expect(r.text).toStartWith("too-deep");
    expect(sent).toEqual([]);
  });

  test("one hop in, the call it makes is hop 2 with the path grown", async () => {
    const { sent, post } = hub();
    await callTool(
      build({}, post),
      "ask_lattice_animals",
      { question: "hi" },
      {
        "x-mcp-hop": "1",
        "x-mcp-path": "lattice",
      },
    );
    expect(sent[0]?.headers["x-mcp-hop"]).toBe("2");
    expect(sent[0]?.headers["x-mcp-path"]).toBe("lattice>mapvest");
  });

  test("a hub that does not answer is an error result that says so", async () => {
    const post: Post = async () => ({ ok: false, reason: "timeout" });
    const r = await callTool(build({}, post), "ask_lattice_animals", { question: "hi" });
    expect(r.isError).toBe(true);
    expect(r.text).toBe("the lattice animals did not answer (timeout)");
  });
});

// ---------------- what the server offers ----------------

describe("tools/list and the manifest", () => {
  const listTools = async (mcp: Mcp) => {
    const out = await mcp.handle({
      method: "POST",
      path: "/mcp",
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    return (out?.json as { result: { tools: Array<Record<string, unknown>> } }).result
      .tools as Array<{
      name: string;
      description: string;
      inputSchema: {
        type: string;
        properties: Record<
          string,
          { type?: string; maxLength?: number; minLength?: number; enum?: string[] }
        >;
        required?: string[];
        additionalProperties?: boolean;
      };
      annotations: { readOnlyHint: boolean; openWorldHint: boolean };
    }>;
  };

  test("exactly the four tools, in order, all read-only, only the relay open-world", async () => {
    const tools = await listTools(build());
    expect(tools.map((t) => t.name)).toEqual([
      "search_intent",
      "rating",
      "brand_lookup",
      "ask_lattice_animals",
    ]);
    for (const t of tools) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.annotations.openWorldHint).toBe(t.name === "ask_lattice_animals");
    }
  });

  test("no tool takes a URL, an address, or an identity", async () => {
    const tools = await listTools(build());
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(t.inputSchema.required?.length).toBeGreaterThan(0);
      for (const key of Object.keys(t.inputSchema.properties)) {
        expect(key).not.toMatch(
          /url|uri|href|endpoint|address|host|user|account|token|device|session/i,
        );
      }
    }
    for (const schema of [
      McpSearchIntentArgs,
      McpBrandLookupArgs,
      McpRatingArgs,
      McpAskLatticeArgs,
    ]) {
      for (const key of ["url", "endpoint", "userId", "peer"]) {
        expect(
          schema.safeParse({ query: "x", brand: "x", ticker: "X", question: "x", [key]: "y" })
            .success,
        ).toBe(false);
      }
    }
  });

  test("descriptions fit the manifest's 300 characters, so none is cut mid-sentence", async () => {
    for (const t of await listTools(build())) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.description.length).toBeLessThanOrEqual(300);
    }
  });

  test("the JSON Schema a client sees and the zod schema the server uses agree", async () => {
    const byName = Object.fromEntries(
      (await listTools(build())).map((t) => [t.name, t.inputSchema]),
    );
    expect(byName.search_intent?.properties.query).toMatchObject({
      type: "string",
      minLength: 1,
      maxLength: MCP_TEXT_MAX_CHARS,
    });
    expect(byName.brand_lookup?.properties.brand).toMatchObject({
      type: "string",
      minLength: 1,
      maxLength: MCP_TEXT_MAX_CHARS,
    });
    expect(byName.rating?.properties.ticker).toMatchObject({
      type: "string",
      minLength: 1,
      maxLength: MCP_TICKER_MAX_CHARS,
    });
    expect(byName.search_intent?.required).toEqual(["query"]);
    expect(byName.brand_lookup?.required).toEqual(["brand"]);
    expect(byName.rating?.required).toEqual(["ticker"]);
    expect(byName.ask_lattice_animals?.required).toEqual(["question"]);
    expect(byName.ask_lattice_animals?.properties.to?.enum).toEqual(
      McpAskLatticeArgs.shape.to.unwrap().options,
    );

    // The bounds are the same on both sides of the line.
    expect(McpSearchIntentArgs.safeParse({ query: "q".repeat(MCP_TEXT_MAX_CHARS) }).success).toBe(
      true,
    );
    expect(
      McpSearchIntentArgs.safeParse({ query: "q".repeat(MCP_TEXT_MAX_CHARS + 1) }).success,
    ).toBe(false);
    expect(McpBrandLookupArgs.safeParse({ brand: "b".repeat(MCP_TEXT_MAX_CHARS) }).success).toBe(
      true,
    );
    expect(
      McpBrandLookupArgs.safeParse({ brand: "b".repeat(MCP_TEXT_MAX_CHARS + 1) }).success,
    ).toBe(false);
    expect(McpRatingArgs.safeParse({ ticker: "T".repeat(MCP_TICKER_MAX_CHARS) }).success).toBe(
      true,
    );
    expect(McpRatingArgs.safeParse({ ticker: "T".repeat(MCP_TICKER_MAX_CHARS + 1) }).success).toBe(
      false,
    );
    expect(
      McpAskLatticeArgs.safeParse({ question: "q".repeat(MCP_QUESTION_MAX_CHARS) }).success,
    ).toBe(true);
    expect(
      McpAskLatticeArgs.safeParse({ question: "q".repeat(MCP_QUESTION_MAX_CHARS + 1) }).success,
    ).toBe(false);
  });

  // Licensed upstream data, everything behind a user, anything that spends on
  // a model, and anything binary: none of it is reachable through the MCP.
  const NOT_OFFERED = [
    "quote",
    "quote-history",
    "quote_history",
    "financials",
    "options",
    "market-data",
    "market_data",
    "market-events",
    "market_events",
    "identify",
    "memo",
    "graph",
    "pulse",
    "environment",
    "agent",
    "finds",
    "watchlist",
    "settings",
    "robinhood",
    "billing",
    "push",
    "alerts",
    "photos",
    "resolve-comparable",
    "resolve_comparable",
    "prism",
    "situate",
    "research",
    "nearby",
    "widget",
    "rm_rf",
  ];

  test("the tools that are not offered are not callable: unknown tool, -32602", async () => {
    const mcp = build();
    for (const name of NOT_OFFERED) {
      const r = await callTool(mcp, name, { ticker: "MCD" });
      expect(r.error?.code).toBe(-32602);
      expect(r.error?.message).toBe(`unknown tool: ${name}`);
      expect(r.result).toBeUndefined();
    }
  });

  test("the manifest names only the four tools and validates against its schema", () => {
    const manifest = McpManifest.parse(build().manifest());
    expect(manifest).toMatchObject({
      name: "mapvest",
      title: "Mapvest",
      endpoint: `${MCP_DEFAULT_ORIGIN}/mcp`,
      transport: "streamable-http",
      stateless: true,
      auth: "none",
      hop: { max: 2 },
    });
    expect(manifest.tools.map((t) => t.name)).toEqual([
      "search_intent",
      "rating",
      "brand_lookup",
      "ask_lattice_animals",
    ]);
    expect(manifest.tools.every((t) => t.readOnly)).toBe(true);
    for (const name of NOT_OFFERED) expect(manifest.tools.map((t) => t.name)).not.toContain(name);
    expect(manifest.peers).toEqual([
      {
        name: "lattice",
        endpoint: `${MCP_DEFAULT_ORIGIN}/mcp/lattice`,
        about: "the lattice animals, the constellation's hub",
      },
    ]);
  });

  test("the origin and the hub's address are the operator's, from the environment", () => {
    const configured = buildMapvestMcp({
      env: {
        MCP_PUBLIC_ORIGIN: "https://mapvest.example/ignored/path",
        LATTICE_MCP_URL: "https://hub.example/mcp",
      },
    });
    expect(McpManifest.parse(configured.manifest()).endpoint).toBe("https://mapvest.example/mcp");
    expect(configured.peers.get("lattice")?.url).toBe("https://hub.example/mcp");

    // Unset, empty, or not a URL: the defaults, never a guess.
    for (const MCP_PUBLIC_ORIGIN of [undefined, "", "  ", "not a url", "ftp://x.example"]) {
      const m = buildMapvestMcp({ env: { MCP_PUBLIC_ORIGIN, LATTICE_MCP_URL: "" } });
      expect(McpManifest.parse(m.manifest()).endpoint).toBe(`${MCP_DEFAULT_ORIGIN}/mcp`);
      expect(m.peers.get("lattice")?.url).toBe(HUB_URL);
    }
  });

  test("a hub address that is plain http is not configured unless the operator allows loopback", () => {
    const env = { LATTICE_MCP_URL: "http://127.0.0.1:9/mcp" };
    expect(buildMapvestMcp({ env }).peers.get("lattice")?.url).toBeNull();
    expect(McpManifest.parse(buildMapvestMcp({ env }).manifest()).peers).toEqual([]);
    expect(
      buildMapvestMcp({ env: { ...env, MCP_ALLOW_LOCAL: "1" } }).peers.get("lattice")?.url,
    ).toBe(env.LATTICE_MCP_URL);
    expect(
      buildMapvestMcp({ env: { ...env, MCP_ALLOW_LOCAL: "true" } }).peers.get("lattice")?.url,
    ).toBeNull();
  });
});
