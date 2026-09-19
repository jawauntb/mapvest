import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Investable, InvestableVerdict } from "@mapvest/core";
import {
  VERDICT_CACHE_TTL_MS,
  VERDICT_FAILURE_TTL_MS,
  _clearVerdictCache,
  attachInvestableVerdicts,
  verdictFromAnswers,
  verdictStateFor,
} from "../src/lib/identify-verdict.js";
import type { JevAnswer, JevBatchResult, JevQuestion, JevState } from "../src/lib/jev-client.js";

/**
 * Snap → investable verdict (lib/identify-verdict.ts). The Jev transport is
 * injected; nothing here touches the network or needs a real JEV_API_KEY
 * beyond a placeholder that lets the batch be attempted.
 */

const originalKey = process.env.JEV_API_KEY;
const NOW = 1_800_000_000_000;

function investable(
  name: string,
  opts: {
    ticker?: string;
    parent?: string;
    comps?: string[];
    etfs?: string[];
    rarity?: string;
  } = {},
): Investable {
  return Investable.parse({
    brand: {
      name,
      isPublic: Boolean(opts.ticker),
      ...(opts.ticker ? { ticker: { symbol: opts.ticker, parent: opts.parent } } : {}),
      ...(opts.parent ? { parent: opts.parent } : {}),
      sector: "Consumer Discretionary",
    },
    comparables: (opts.comps ?? []).map((t) => ({
      ticker: t,
      name: t,
      score: 0.7,
      reasoning: "test",
      sources: [],
    })),
    etfs: (opts.etfs ?? []).map((t) => ({
      ticker: t,
      name: t,
      weight: 0.05,
      source: { provider: "manual", fetchedAt: "2026-01-01T00:00:00.000Z", confidence: "high" },
    })),
    confidence: "high",
    sources: [],
    ...(opts.rarity ? { rarity: opts.rarity } : {}),
  });
}

type AskCall = { state: JevState; questions: Record<string, JevQuestion> };

function fakeAsk(calls: AskCall[], respond: (call: AskCall) => JevBatchResult | Promise<never>) {
  return async (state: JevState, questions: Record<string, JevQuestion>) => {
    const call = { state, questions };
    calls.push(call);
    return respond(call);
  };
}

function choice(exposure: string, confidence: number, p?: number): JevAnswer {
  return {
    type: "choice",
    choice: exposure,
    probabilities: { [exposure]: p ?? confidence },
    confidence,
  };
}
const noul = (p: number): JevAnswer => ({ type: "noul", noul: p });

/** Answers every detection in the call: d0 parent/0.88, d1 proxy/0.3 (worth), d2 low confidence. */
function answerAll(call: AskCall): JevBatchResult {
  const answers: Record<string, JevAnswer> = {};
  const ids = Object.keys(call.questions)
    .filter((k) => k.startsWith("exposure_"))
    .map((k) => k.slice("exposure_".length));
  const plan = [
    { c: choice("parent", 0.9, 0.88), n: noul(0.81) },
    { c: choice("proxy", 0.7), n: noul(0.3) },
    { c: choice("direct", 0.4), n: noul(0.9) },
  ];
  ids.forEach((id, i) => {
    const p = plan[i % plan.length]!;
    answers[`exposure_${id}`] = p.c;
    answers[`look_${id}`] = p.n;
  });
  return { ok: true, answers, usage: { inputTokens: 1, outputTokens: 1 } };
}

beforeEach(() => {
  _clearVerdictCache();
  process.env.JEV_API_KEY = "test-jev-key";
});

afterEach(() => {
  if (originalKey === undefined) {
    // biome-ignore lint/performance/noDelete: `= undefined` stores the string "undefined" on Bun >= 1.4 — delete is the only way to unset
    delete process.env.JEV_API_KEY;
  } else {
    process.env.JEV_API_KEY = originalKey;
  }
});

describe("attachInvestableVerdicts", () => {
  test("one batched call for every detection; verdicts attach in order and validate", async () => {
    const calls: AskCall[] = [];
    const input = [
      investable("Converse", { ticker: "NKE", parent: "Nike Inc" }),
      investable("Blue Bottle", { comps: ["SBUX"], etfs: ["XLY"] }),
      investable("Nike", { ticker: "NKE" }),
    ];
    const out = await attachInvestableVerdicts(input, { ask: fakeAsk(calls, answerAll), now: NOW });

    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]!.questions)).toHaveLength(6);
    const state = calls[0]!.state as { detections: Record<string, unknown> };
    expect(Object.keys(state.detections)).toEqual(["d0", "d1", "d2"]);
    expect(state.detections.d1).toMatchObject({
      brand: "Blue Bottle",
      is_public: false,
      comparables: [{ ticker: "SBUX" }],
      etfs: [{ ticker: "XLY" }],
    });
    // No watchlist supplied → no `on_watchlist` in the state and no `watchlisted` on the verdict.
    expect(state.detections.d0).not.toHaveProperty("on_watchlist");

    expect(out).toHaveLength(3);
    expect(out.map((i) => i.brand.name)).toEqual(["Converse", "Blue Bottle", "Nike"]);
    expect(out[0]!.verdict).toEqual({ exposure: "parent", probability: 0.88, worth_a_look: 0.81 });
    expect(out[1]!.verdict).toEqual({ exposure: "proxy", probability: 0.7, worth_a_look: 0.3 });
    // d2 answered below 0.55 confidence → no verdict, everything else untouched.
    expect(out[2]!.verdict).toBeUndefined();
    expect(out[2]).toBe(input[2]!);
    for (const inv of out) expect(Investable.parse(inv)).toEqual(inv);
    expect(InvestableVerdict.parse(out[0]!.verdict)).toEqual(out[0]!.verdict!);
  });

  test("watchlist membership rides along as `watchlisted` when supplied", async () => {
    const out = await attachInvestableVerdicts(
      [investable("Nike", { ticker: "NKE" }), investable("Hershey's", { ticker: "HSY" })],
      { ask: fakeAsk([], answerAll), now: NOW, watchlist: new Set(["NKE"]) },
    );
    expect(out[0]!.verdict?.watchlisted).toBe(true);
    expect(out[1]!.verdict?.watchlisted).toBe(false);
  });

  test("fails open: a Jev failure returns the input untouched and is not retried for a minute", async () => {
    const calls: AskCall[] = [];
    const input = [investable("Nike", { ticker: "NKE" })];
    const ask = fakeAsk(calls, () => ({ ok: false, reason: "http_error" }) as JevBatchResult);
    const out = await attachInvestableVerdicts(input, { ask, now: NOW });
    expect(out[0]).toBe(input[0]!);
    expect(out[0]!.verdict).toBeUndefined();
    await attachInvestableVerdicts(input, { ask, now: NOW + 1000 });
    expect(calls).toHaveLength(1);
    await attachInvestableVerdicts(input, { ask, now: NOW + VERDICT_FAILURE_TTL_MS + 1 });
    expect(calls).toHaveLength(2);
  });

  test("fails open on a throwing transport and on a hung one (bounded by timeoutMs)", async () => {
    const input = [investable("Nike", { ticker: "NKE" })];
    const thrown = await attachInvestableVerdicts(input, {
      ask: async () => {
        throw new Error("boom");
      },
      now: NOW,
    });
    expect(thrown[0]!.verdict).toBeUndefined();
    _clearVerdictCache();
    const started = Date.now();
    const hung = await attachInvestableVerdicts(input, {
      ask: () => new Promise(() => {}),
      timeoutMs: 30,
      now: NOW,
    });
    expect(hung[0]!.verdict).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("no JEV_API_KEY → no call, no verdict", async () => {
    // biome-ignore lint/performance/noDelete: see afterEach
    delete process.env.JEV_API_KEY;
    const calls: AskCall[] = [];
    const out = await attachInvestableVerdicts([investable("Nike", { ticker: "NKE" })], {
      ask: fakeAsk(calls, answerAll),
      now: NOW,
    });
    expect(calls).toHaveLength(0);
    expect(out[0]!.verdict).toBeUndefined();
  });

  test("identical resolutions are answered from cache for 15 minutes", async () => {
    const calls: AskCall[] = [];
    const ask = fakeAsk(calls, answerAll);
    const a = await attachInvestableVerdicts([investable("Nike", { ticker: "NKE" })], {
      ask,
      now: NOW,
    });
    const b = await attachInvestableVerdicts([investable("Nike", { ticker: "NKE" })], {
      ask,
      now: NOW + VERDICT_CACHE_TTL_MS - 1,
    });
    expect(calls).toHaveLength(1);
    expect(b[0]!.verdict).toEqual(a[0]!.verdict!);
    // A different rarity is a different resolution → new call.
    await attachInvestableVerdicts([investable("Nike", { ticker: "NKE", rarity: "legendary" })], {
      ask,
      now: NOW,
    });
    expect(calls).toHaveLength(2);
  });

  test("an empty list is returned as-is without a call", async () => {
    const calls: AskCall[] = [];
    const out = await attachInvestableVerdicts([], { ask: fakeAsk(calls, answerAll) });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("verdictFromAnswers", () => {
  test("uses the probability on the chosen exposure, falling back to confidence", () => {
    expect(verdictFromAnswers(choice("direct", 0.9, 0.7), noul(0.2), undefined)).toEqual({
      exposure: "direct",
      probability: 0.7,
      worth_a_look: 0.2,
    });
    expect(
      verdictFromAnswers(
        { type: "choice", choice: "proxy", probabilities: {}, confidence: 0.6 },
        undefined,
        true,
      ),
    ).toEqual({ exposure: "proxy", probability: 0.6, worth_a_look: 0.5, watchlisted: true });
  });

  test("rejects unusable answers", () => {
    expect(verdictFromAnswers(choice("direct", 0.54), noul(0.9), undefined)).toBeNull();
    expect(verdictFromAnswers(choice("sideways", 0.9), noul(0.9), undefined)).toBeNull();
    expect(verdictFromAnswers(noul(0.9), noul(0.9), undefined)).toBeNull();
    expect(verdictFromAnswers(undefined, undefined, undefined)).toBeNull();
  });

  test("state never carries raw photo text — only the resolution", () => {
    const state = verdictStateFor(investable("Nike", { ticker: "NKE", parent: "Nike Inc" }), false);
    expect(Object.keys(state).sort()).toEqual(
      [
        "brand",
        "parent",
        "sector",
        "is_public",
        "ticker",
        "ticker_parent",
        "comparables",
        "etfs",
        "identification_confidence",
        "on_watchlist",
      ].sort(),
    );
  });
});
