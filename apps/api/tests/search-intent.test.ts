import { afterEach, beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { SearchIntentResponse } from "@mapvest/core";
import { app } from "../src/index.js";
import type { JevAnswer, JevBatchResult, JevQuestion, JevState } from "../src/lib/jev-client.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import {
  _clearSearchIntentCache,
  deterministicIntent,
  fallbackIntent,
  isQuestion,
  looksLikePlace,
  resolveSearchIntent,
  seedLookup,
  tickerShape,
} from "../src/lib/search-intent.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";

/**
 * Search intent routing (lib/search-intent.ts). The live-quote probe and the
 * Jev transport are injected; nothing reaches the network. The seed brand
 * table (`brands.json`) is real — "nike" and "burger king" are known keys.
 */

const originalKey = process.env.JEV_API_KEY;
const originalFetch = globalThis.fetch;

const quoteHit = async () => ({ symbol: "X" });
const quoteMiss = async () => null;

type AskCall = { state: JevState; questions: Record<string, JevQuestion> };

function fakeAsk(calls: AskCall[], respond: () => JevBatchResult) {
  return async (state: JevState, questions: Record<string, JevQuestion>) => {
    calls.push({ state, questions });
    return respond();
  };
}

function jevChoice(intent: string, confidence: number, p?: number): JevBatchResult {
  const answer: JevAnswer = {
    type: "choice",
    choice: intent,
    probabilities: { [intent]: p ?? confidence },
    confidence,
  };
  return { ok: true, answers: { intent: answer }, usage: { inputTokens: 1, outputTokens: 1 } };
}

beforeEach(() => {
  _clearSearchIntentCache();
  __resetRateLimit();
  __resetMetrics();
  process.env.JEV_API_KEY = "test-jev-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) {
    // biome-ignore lint/performance/noDelete: `= undefined` stores the string "undefined" on Bun >= 1.4 — delete is the only way to unset
    delete process.env.JEV_API_KEY;
  } else {
    process.env.JEV_API_KEY = originalKey;
  }
});

describe("deterministic first pass", () => {
  test("cashtag → ticker without a quote probe", async () => {
    let probes = 0;
    const calls: AskCall[] = [];
    const res = await resolveSearchIntent(
      { q: "$nvda" },
      {
        quote: async () => {
          probes += 1;
          return null;
        },
        ask: fakeAsk(calls, () => jevChoice("brand", 0.9)),
      },
    );
    expect(probes).toBe(0);
    expect(calls).toHaveLength(0);
    expect(res).toEqual({
      intent: "ticker",
      probability: 0.97,
      resolved: { symbol: "NVDA" },
      route: { screen: "detail", params: { id: "NVDA" } },
      method: "deterministic",
    });
    expect(SearchIntentResponse.parse(res)).toEqual(res);
  });

  test("ticker shape + live quote hit → ticker (case-insensitive)", async () => {
    const res = await resolveSearchIntent({ q: "aapl" }, { quote: quoteHit });
    expect(res.intent).toBe("ticker");
    expect(res.resolved.symbol).toBe("AAPL");
    expect(res.route).toEqual({ screen: "detail", params: { id: "AAPL" } });
    expect(res.method).toBe("deterministic");
  });

  test("seed brand hit → brand routed to its ticker", async () => {
    const res = await resolveSearchIntent({ q: "Nike" }, { quote: quoteMiss });
    expect(res.intent).toBe("brand");
    expect(res.resolved).toEqual({ brand: "Nike", symbol: "NKE" });
    expect(res.route).toEqual({ screen: "detail", params: { id: "NKE" } });
    expect(res.probability).toBe(0.95);
  });

  test("longest seed substring → brand", async () => {
    const res = await resolveSearchIntent({ q: "burger king drive thru" }, { quote: quoteMiss });
    expect(res.intent).toBe("brand");
    expect(res.resolved.symbol).toBe("QSR");
    expect(res.probability).toBe(0.8);
  });

  test("place words → map with the place query", async () => {
    const res = await resolveSearchIntent({ q: "coffee shops near me" }, { quote: quoteMiss });
    expect(res).toMatchObject({
      intent: "place",
      resolved: { placeQuery: "coffee shops near me" },
      route: { screen: "map", params: { q: "coffee shops near me" } },
      method: "deterministic",
    });
  });

  test("a known brand plus place words is a place search, not the brand page", async () => {
    const res = await resolveSearchIntent({ q: "starbucks near me" }, { quote: quoteMiss });
    expect(res.intent).toBe("place");
  });

  test("geo hint + preposition → place even without a place word", () => {
    expect(looksLikePlace("things in brooklyn", true)).toBe(true);
    expect(looksLikePlace("things in brooklyn", false)).toBe(false);
  });

  test("question shape → research", async () => {
    for (const q of [
      "why is nvidia down today?",
      "should i buy apple stock",
      "How exposed is Nike to tariffs",
    ]) {
      const res = await resolveSearchIntent({ q }, { quote: quoteHit });
      expect(res.intent).toBe("question");
      expect(res.route).toEqual({ screen: "research", params: { q } });
    }
    expect(isQuestion("is")).toBe(false);
    expect(isQuestion("AAPL")).toBe(false);
  });

  test("helpers", () => {
    expect(tickerShape("$brk.b")).toBe("BRK.B");
    expect(tickerShape("starbucks")).toBeUndefined();
    expect(seedLookup("nike")?.ticker).toBe("NKE");
    expect(seedLookup("zzzz unknown")).toBeUndefined();
    expect(
      deterministicIntent("kith", { hasGeo: false, cashtag: false, quoteHit: false }),
    ).toBeNull();
    // Ticker-shaped text keeps today's behavior exactly: uppercase and open the detail sheet.
    expect(fallbackIntent("kith")).toEqual({
      intent: "ticker",
      probability: 0.5,
      resolved: { symbol: "KITH" },
      route: { screen: "detail", params: { id: "KITH" } },
      method: "fallback",
    });
    expect(fallbackIntent("blue bottle")).toEqual({
      intent: "ticker",
      probability: 0.5,
      resolved: {},
      route: { screen: "detail", params: { id: "blue bottle" } },
      method: "fallback",
    });
  });
});

describe("Jev for the ambiguous remainder", () => {
  test("a confident choice decides; only the ambiguous query reaches Jev", async () => {
    const calls: AskCall[] = [];
    const res = await resolveSearchIntent(
      { q: "kith" },
      { quote: quoteMiss, ask: fakeAsk(calls, () => jevChoice("brand", 0.82, 0.77)) },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.questions.intent?.type).toBe("choice");
    expect(calls[0]!.state).toMatchObject({ query: "kith", looks_like_ticker: true });
    expect(res).toEqual({
      intent: "brand",
      probability: 0.77,
      resolved: { brand: "kith" },
      route: { screen: "detail", params: { id: "kith" } },
      method: "jev",
    });
  });

  test("Jev picking place / question routes to map / research", async () => {
    const place = await resolveSearchIntent(
      { q: "williamsburg waterfront" },
      { quote: quoteMiss, ask: fakeAsk([], () => jevChoice("place", 0.7)) },
    );
    expect(place.route).toEqual({ screen: "map", params: { q: "williamsburg waterfront" } });
    const question = await resolveSearchIntent(
      { q: "lumenaris outlook" },
      { quote: quoteMiss, ask: fakeAsk([], () => jevChoice("question", 0.66)) },
    );
    expect(question.route).toEqual({
      screen: "research",
      params: { q: "lumenaris outlook" },
    });
  });

  test("fails open to today's behavior on Jev failure, low confidence, or no key", async () => {
    const failed = await resolveSearchIntent(
      { q: "kith" },
      { quote: quoteMiss, ask: async () => ({ ok: false, reason: "timeout" }) },
    );
    expect(failed.method).toBe("fallback");
    expect(failed.intent).toBe("ticker");
    expect(failed.route).toEqual({ screen: "detail", params: { id: "KITH" } });

    _clearSearchIntentCache();
    const low = await resolveSearchIntent(
      { q: "kith" },
      { quote: quoteMiss, ask: fakeAsk([], () => jevChoice("brand", 0.4)) },
    );
    expect(low.method).toBe("fallback");

    _clearSearchIntentCache();
    const thrown = await resolveSearchIntent(
      { q: "kith" },
      {
        quote: quoteMiss,
        ask: async () => {
          throw new Error("boom");
        },
      },
    );
    expect(thrown.method).toBe("fallback");

    // biome-ignore lint/performance/noDelete: see afterEach
    delete process.env.JEV_API_KEY;
    const calls: AskCall[] = [];
    const noKey = await resolveSearchIntent(
      { q: "kith" },
      { quote: quoteMiss, ask: fakeAsk(calls, () => jevChoice("brand", 0.9)) },
    );
    expect(calls).toHaveLength(0);
    expect(noKey.method).toBe("fallback");
  });

  test("a slow quote probe never stalls the answer", async () => {
    const started = Date.now();
    const res = await resolveSearchIntent(
      { q: "ZZZQ" },
      { quote: () => new Promise(() => {}), ask: fakeAsk([], () => jevChoice("ticker", 0.7)) },
    );
    // INTENT_QUOTE_TIMEOUT_MS is 1.5s; the probe hangs, so this proves the bound.
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(res.intent).toBe("ticker");
  });
});

describe("cache", () => {
  test("a decided query is memoized per normalized text; a fallback is not", async () => {
    const calls: AskCall[] = [];
    const ask = fakeAsk(calls, () => jevChoice("brand", 0.9));
    await resolveSearchIntent({ q: "  Kith " }, { quote: quoteMiss, ask, now: 1 });
    await resolveSearchIntent({ q: "kith" }, { quote: quoteMiss, ask, now: 2 });
    expect(calls).toHaveLength(1);

    const failing = async () => ({ ok: false, reason: "timeout" }) as JevBatchResult;
    await resolveSearchIntent({ q: "quorvex" }, { quote: quoteMiss, ask: failing, now: 1 });
    const later = await resolveSearchIntent({ q: "quorvex" }, { quote: quoteMiss, ask, now: 2 });
    expect(later.method).toBe("jev");
  });
});

describe("POST /v1/search/intent", () => {
  test("400 without q", async () => {
    const res = await app.fetch(
      new Request("http://localhost/v1/search/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("200 with the documented shape (deterministic question, no network)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const res = await app.fetch(
      new Request("http://localhost/v1/search/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: "what does nvidia sell?", lat: 40.7, lng: -73.9 }),
      }),
    );
    expect(res.status).toBe(200);
    const body = SearchIntentResponse.parse(await res.json());
    expect(body.intent).toBe("question");
    expect(body.route.screen).toBe("research");
  });
});
