import { afterEach, beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { RATING_DISCLAIMER, RatingResponse } from "@mapvest/core";
import { app } from "../src/index.js";
import type { JevAnswer, JevBatchResult, JevQuestion, JevState } from "../src/lib/jev-client.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import {
  type EvidenceItem,
  PRIMARY_DRIVER_QUESTION_ID,
  RATING_CACHE_TTL_MS,
  RATING_INSUFFICIENT_TTL_MS,
  RATING_QUESTION_ID,
  RATING_SOURCE_IDS,
  type RatingSourceFn,
  type RatingSources,
  _clearRatingCache,
  buildRating,
  buildRatingQuestions,
  driverQuestionId,
  normalizeProbabilities,
  oneLineFor,
  peerForecastItem,
  prismItem,
  situateItem,
} from "../src/lib/rating.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";

/**
 * Rating assembly (lib/rating.ts) with every evidence source and the Jev
 * transport injected — no network, no JEV_API_KEY, no provider keys. The
 * route test stubs `globalThis.fetch` to fail so every live source falls
 * open and the endpoint still answers with the documented shape.
 */

const NOW = new Date("2026-09-19T14:00:00.000Z");
const originalFetch = globalThis.fetch;

function item(
  id: EvidenceItem["id"],
  driver: EvidenceItem["driver"],
  summary = `${id} summary`,
): EvidenceItem {
  return { id, driver, facts: { note: summary }, evidence: { source: id, summary } };
}

const returns =
  (value: EvidenceItem | null): RatingSourceFn =>
  async () =>
    value;
const throws: RatingSourceFn = async () => {
  throw new Error("provider down");
};
const hangs: RatingSourceFn = () => new Promise(() => {});

/** Every source absent unless overridden. */
function noSources(overrides: Partial<RatingSources> = {}): RatingSources {
  const out = {} as RatingSources;
  for (const id of RATING_SOURCE_IDS) out[id] = returns(null);
  return { ...out, ...overrides };
}

type AskCall = { state: JevState; questions: Record<string, JevQuestion> };

function fakeAsk(calls: AskCall[], respond: (call: AskCall) => JevBatchResult) {
  return async (state: JevState, questions: Record<string, JevQuestion>) => {
    const call = { state, questions };
    calls.push(call);
    return respond(call);
  };
}

function scoreAnswer(probabilities: Record<string, number>, confidence: number, score = 3) {
  return { type: "score", score, legend: {}, probabilities, confidence };
}

function choiceAnswer(choice: string, confidence: number) {
  return { type: "choice", choice, probabilities: { [choice]: confidence }, confidence };
}

const noul = (p: number) => ({ type: "noul", noul: p });

/** A confident BUY with momentum + fundamentals up, macro down. */
function goodAnswers(): JevBatchResult {
  return {
    ok: true,
    usage: { inputTokens: 100, outputTokens: 10 },
    answers: {
      [RATING_QUESTION_ID]: scoreAnswer(
        { strong_sell: 0.02, sell: 0.05, hold: 0.2, buy: 0.58, strong_buy: 0.15 },
        0.72,
      ),
      [PRIMARY_DRIVER_QUESTION_ID]: choiceAnswer("momentum", 0.8),
      [driverQuestionId("momentum")]: noul(0.82),
      [driverQuestionId("fundamentals")]: noul(0.66),
      [driverQuestionId("macro")]: noul(0.22),
      [driverQuestionId("valuation")]: noul(0.5),
    } as Record<string, JevAnswer>,
  };
}

const FOUR_SOURCES: Partial<RatingSources> = {
  quote: returns(item("quote", "momentum", "Price $100 (+1.0% today); 1m +4.0%")),
  ratios: returns(item("ratios", "valuation", "P/E 25.0")),
  synthesis: returns(item("synthesis", "fundamentals", "Pricing power sits with the company")),
  environment: returns(item("environment", "macro", "Tech: rates are the field")),
};

beforeEach(() => {
  _clearRatingCache();
  __resetRateLimit();
  __resetMetrics();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("buildRating — evidence gathering", () => {
  test("fewer than two sources → insufficient_signal and Jev is never asked", async () => {
    const calls: AskCall[] = [];
    const res = await buildRating("NVDA", {
      now: NOW,
      sources: noSources({ quote: FOUR_SOURCES.quote }),
      ask: fakeAsk(calls, goodAnswers),
    });
    expect(calls).toHaveLength(0);
    expect(res.status).toBe("insufficient_signal");
    expect(res.rating).toBeNull();
    expect(res.probabilities).toBeNull();
    expect(res.confidence).toBe(0);
    expect(res.inputs_used).toEqual(["quote"]);
    expect(res.evidence).toHaveLength(1);
    expect(res.disclaimer).toBe(RATING_DISCLAIMER);
    expect(res.as_of).toBe(NOW.toISOString());
    expect(RatingResponse.parse(res)).toEqual(res);
  });

  test("a throwing or hanging source is absent; the rest still rate (fail open per source)", async () => {
    const calls: AskCall[] = [];
    const res = await buildRating("NVDA", {
      now: NOW,
      sourceTimeoutMs: 20,
      sources: noSources({
        ...FOUR_SOURCES,
        headlines: throws,
        peer_forecast: hangs,
      }),
      ask: fakeAsk(calls, goodAnswers),
    });
    expect(res.status).toBe("ok");
    expect(res.inputs_used).toEqual(["quote", "ratios", "synthesis", "environment"]);
    expect(res.inputs_used).not.toContain("headlines");
    expect(res.inputs_used).not.toContain("peer_forecast");
  });

  test("the Jev state carries one keyed block per source and one noul per driver", async () => {
    const calls: AskCall[] = [];
    await buildRating("NVDA", {
      now: NOW,
      sources: noSources(FOUR_SOURCES),
      ask: fakeAsk(calls, goodAnswers),
    });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    const state = call.state as { ticker: string; evidence: Record<string, unknown> };
    expect(state.ticker).toBe("NVDA");
    expect(Object.keys(state.evidence).sort()).toEqual(
      ["environment", "quote", "ratios", "synthesis"].sort(),
    );
    expect(call.questions[RATING_QUESTION_ID]?.type).toBe("score");
    expect((call.questions[RATING_QUESTION_ID] as { criteria: string[] }).criteria).toEqual([
      "strong_sell",
      "sell",
      "hold",
      "buy",
      "strong_buy",
    ]);
    const primary = call.questions[PRIMARY_DRIVER_QUESTION_ID] as {
      criteria: Record<string, null>;
    };
    expect(Object.keys(primary.criteria).sort()).toEqual(
      ["valuation", "momentum", "fundamentals", "macro"].sort(),
    );
    for (const d of ["valuation", "momentum", "fundamentals", "macro"]) {
      expect(call.questions[driverQuestionId(d as never)]?.type).toBe("noul");
    }
    expect(call.questions[driverQuestionId("narrative")]).toBeUndefined();
  });
});

describe("buildRating — rating from answers", () => {
  test("confident score → ok rating, primary driver first, deterministic one_line", async () => {
    const res = await buildRating("NVDA", {
      now: NOW,
      sources: noSources(FOUR_SOURCES),
      ask: fakeAsk([], goodAnswers),
    });
    expect(res.status).toBe("ok");
    expect(res.rating).toEqual({
      action: "buy",
      strength: "strong", // 0.58 − 0.20 = 0.38 margin
      conviction: 0.72,
      one_line: "Buy · momentum + fundamentals; macro headwind",
    });
    expect(res.confidence).toBe(0.72);
    expect(res.probabilities).toEqual({
      strong_sell: 0.02,
      sell: 0.05,
      hold: 0.2,
      buy: 0.58,
      strong_buy: 0.15,
    });
    // Primary (Jev's choice) first, then by weight: macro (0.56) outranks fundamentals (0.32).
    expect(res.drivers.map((d) => d.name)).toEqual([
      "momentum",
      "macro",
      "fundamentals",
      "valuation",
    ]);
    expect(res.drivers[0]).toEqual({ name: "momentum", direction: "up", weight: 0.64 });
    expect(res.drivers[1]).toEqual({ name: "macro", direction: "down", weight: 0.56 });
    expect(res.drivers[2]).toEqual({ name: "fundamentals", direction: "up", weight: 0.32 });
    expect(res.drivers[3]).toEqual({ name: "valuation", direction: "flat", weight: 0 });
    expect(RatingResponse.parse(res)).toEqual(res);
  });

  test("confidence below 0.55 → insufficient_signal but drivers survive", async () => {
    const res = await buildRating("NVDA", {
      now: NOW,
      sources: noSources(FOUR_SOURCES),
      ask: fakeAsk([], () => {
        const a = goodAnswers();
        (a as { answers: Record<string, unknown> }).answers[RATING_QUESTION_ID] = scoreAnswer(
          { buy: 0.4, hold: 0.35, sell: 0.25 },
          0.4,
        );
        return a;
      }),
    });
    expect(res.status).toBe("insufficient_signal");
    expect(res.rating).toBeNull();
    expect(res.probabilities).toBeNull();
    expect(res.drivers.length).toBe(4);
    expect(res.inputs_used).toHaveLength(4);
    expect(RatingResponse.parse(res)).toEqual(res);
  });

  test("Jev failure (no key / transport) → insufficient_signal, same shape, no throw", async () => {
    const res = await buildRating("NVDA", {
      now: NOW,
      sources: noSources(FOUR_SOURCES),
      ask: async () => ({ ok: false, reason: "no_api_key" }),
    });
    expect(res.status).toBe("insufficient_signal");
    expect(res.rating).toBeNull();
    expect(res.drivers).toEqual([]);
    expect(res.inputs_used).toHaveLength(4);
    expect(RatingResponse.parse(res)).toEqual(res);
  });

  test("a throwing transport is caught", async () => {
    const res = await buildRating("NVDA", {
      now: NOW,
      sources: noSources(FOUR_SOURCES),
      ask: async () => {
        throw new Error("boom");
      },
    });
    expect(res.status).toBe("insufficient_signal");
  });

  test("probabilities keyed by criteria index are mapped onto the actions", () => {
    expect(normalizeProbabilities({ "0": 0.1, "1": 0.1, "2": 0.2, "3": 0.5, "4": 0.1 })).toEqual({
      strong_sell: 0.1,
      sell: 0.1,
      hold: 0.2,
      buy: 0.5,
      strong_buy: 0.1,
    });
    expect(normalizeProbabilities({ nonsense: 1 })).toBeNull();
    expect(normalizeProbabilities(null)).toBeNull();
  });

  test("oneLineFor is deterministic from the drivers", () => {
    expect(oneLineFor("hold", [])).toBe("Hold · mixed signals");
    expect(
      oneLineFor("sell", [
        { name: "macro", direction: "down", weight: 0.7 },
        { name: "valuation", direction: "down", weight: 0.5 },
        { name: "narrative", direction: "up", weight: 0.2 },
      ]),
    ).toBe("Sell · news flow; macro + valuation headwinds");
    expect(
      oneLineFor("strong_buy", [
        { name: "peer_forecast", direction: "up", weight: 0.9 },
        { name: "local_demand", direction: "up", weight: 0.6 },
        { name: "momentum", direction: "up", weight: 0.5 },
      ]),
    ).toBe("Strong buy · peer forecast + demand pulse");
  });
});

describe("buildRating — cache", () => {
  test("an ok rating is served from cache for an hour; Jev is asked once", async () => {
    const calls: AskCall[] = [];
    const opts = { sources: noSources(FOUR_SOURCES), ask: fakeAsk(calls, goodAnswers) };
    const first = await buildRating("nvda", { ...opts, now: NOW });
    const second = await buildRating("NVDA", {
      ...opts,
      now: new Date(NOW.getTime() + RATING_CACHE_TTL_MS - 1000),
    });
    expect(calls).toHaveLength(1);
    expect(second).toBe(first);
    await buildRating("NVDA", { ...opts, now: new Date(NOW.getTime() + RATING_CACHE_TTL_MS + 1) });
    expect(calls).toHaveLength(2);
  });

  test("an insufficient rating is remembered only briefly", async () => {
    const calls: AskCall[] = [];
    const opts = {
      sources: noSources(FOUR_SOURCES),
      ask: fakeAsk(calls, () => ({ ok: false, reason: "timeout" }) as JevBatchResult),
    };
    await buildRating("NVDA", { ...opts, now: NOW });
    await buildRating("NVDA", { ...opts, now: new Date(NOW.getTime() + 1000) });
    expect(calls).toHaveLength(1);
    await buildRating("NVDA", {
      ...opts,
      now: new Date(NOW.getTime() + RATING_INSUFFICIENT_TTL_MS + 1),
    });
    expect(calls).toHaveLength(2);
  });

  test("concurrent callers share one computation", async () => {
    const calls: AskCall[] = [];
    const opts = { sources: noSources(FOUR_SOURCES), ask: fakeAsk(calls, goodAnswers), now: NOW };
    const [a, b] = await Promise.all([buildRating("NVDA", opts), buildRating("NVDA", opts)]);
    expect(calls).toHaveLength(1);
    expect(a).toBe(b);
  });
});

describe("upstream evidence mappers", () => {
  test("peerForecastItem follows the SHARED CONTRACT and drops unavailable bodies", () => {
    const body = {
      available: true,
      ticker: "NVDA",
      sector: "Information Technology",
      sector_etf: "XLK",
      horizon_months: 3,
      method: "tabicl_v2_icl",
      as_of: "2026-09-19T00:00:00Z",
      bucket: "over",
      probabilities: { strong_under: 0.05, under: 0.1, inline: 0.25, over: 0.4, strong_over: 0.2 },
      expected_excess_return: 0.031,
      confidence: 0.61,
      context_rows: 1200,
      features: ["mom_12_1"],
      peers: [
        { symbol: "AMD", bucket: "inline", expected_excess_return: 0.004, probabilities: {} },
        { symbol: "AVGO", bucket: "over", expected_excess_return: null, probabilities: {} },
      ],
    };
    const it = peerForecastItem(body, "NVDA");
    expect(it?.id).toBe("peer_forecast");
    expect(it?.driver).toBe("peer_forecast");
    expect(it?.facts.bucket).toBe("over");
    expect(it?.facts.expected_excess_return).toBe(0.031);
    expect((it?.facts.peers as unknown[]).length).toBe(2);
    expect(it?.evidence.summary).toBe(
      "Peer forecast: over (40%) vs XLK over 3m expected excess +3.1%",
    );
    expect(it?.evidence.ref).toContain("/api/tabular/peer-forecast/NVDA");
    expect(
      peerForecastItem({ available: false, reason: "model not installed" }, "NVDA"),
    ).toBeNull();
    expect(peerForecastItem(null, "NVDA")).toBeNull();
  });

  test("prismItem reads the stored recommendation + scenario split", () => {
    const it = prismItem(
      {
        ticker: "NVDA",
        recommendation: { action: "buy", strength: "normal", conviction: 0.62, one_line: "x" },
        scenarios: { cases: { bull: { probability: 0.41 }, bear: { probability: 0.21 } } },
        regime: { label: "risk-on" },
      },
      "NVDA",
    );
    expect(it?.facts.recommendation).toBe("buy");
    expect(it?.facts.scenarios).toEqual({ bull: 0.41, bear: 0.21 });
    expect(it?.evidence.summary).toBe(
      "Prism: buy (normal), conviction 62%; bull 41% / bear 21%; regime risk-on",
    );
    expect(prismItem({ ticker: "NVDA" }, "NVDA")).toBeNull();
  });

  test("situateItem reads the posture and nothing else", () => {
    const it = situateItem(
      { posture: { stance: "odds_favorable", horizon: "3m", conviction: 0.58, one_line: "x" } },
      "NVDA",
    );
    expect(it?.facts).toEqual({ stance: "odds_favorable", horizon: "3m", conviction: 0.58 });
    expect(it?.evidence.summary).toBe("Situate: odds favorable at 3m, conviction 58%");
    expect(situateItem({ posture: null }, "NVDA")).toBeNull();
  });
});

describe("GET /v1/rating/:ticker", () => {
  test("400 on a malformed ticker", async () => {
    const res = await app.fetch(new Request("http://localhost/v1/rating/not-a-ticker"));
    expect(res.status).toBe(400);
  });

  test("200 insufficient_signal with the documented shape when every source fails open", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const res = await app.fetch(new Request("http://localhost/v1/rating/zzzq"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    const parsed = RatingResponse.parse(body);
    expect(parsed.ticker).toBe("ZZZQ");
    expect(parsed.status).toBe("insufficient_signal");
    expect(parsed.rating).toBeNull();
    expect(parsed.disclaimer).toBe(RATING_DISCLAIMER);
  });
});
