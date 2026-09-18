import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { JEV_MIN_CONFIDENCE, askJev, choice, noul, score } from "../src/lib/jev-client.js";

/**
 * Jev / Typesafe client — every test mocks `globalThis.fetch`. None of this
 * suite makes a network call or needs a real JEV_API_KEY (per the CREDENTIALS
 * contract for this integration).
 */

const originalFetch = globalThis.fetch;
const originalKey = process.env.JEV_API_KEY;

type FetchCall = { url: string; body: unknown };

function stubFetch(calls: FetchCall[], handler: () => Response): void {
  globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, body });
    return handler();
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
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

describe("askJev — auth and transport", () => {
  test("fails closed with no_api_key when JEV_API_KEY is unset", async () => {
    // biome-ignore lint/performance/noDelete: `= undefined` stores the string "undefined" on Bun >= 1.4 — delete is the only way to unset
    delete process.env.JEV_API_KEY;
    const calls: FetchCall[] = [];
    stubFetch(calls, () => jsonResponse(200, { answers: {} }));
    const result = await askJev("state", { q: { type: "noul", instructions: "?" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_api_key");
    expect(calls).toHaveLength(0);
  });

  test("sends the documented request shape", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () =>
      jsonResponse(200, {
        model: "jev-latest",
        answers: { q: { type: "noul", noul: 0.9 } },
        usage: { input_tokens: 12, output_tokens: 0 },
      }),
    );
    await askJev({ headlines: ["a"] }, { q: { type: "noul", instructions: "well?" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(calls[0]?.body).toEqual({
      state: { headlines: ["a"] },
      model: "jev-latest",
      questions: { q: { type: "noul", instructions: "well?" } },
    });
  });

  test("401 fails closed as http_error, not retried", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => jsonResponse(401, { error: "bad key" }));
    const result = await askJev("s", { q: { type: "noul", instructions: "?" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("http_error");
    expect(calls).toHaveLength(1);
  });

  test("422 fails closed as http_error", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => jsonResponse(422, { error: "validation" }));
    const result = await askJev("s", { q: { type: "noul", instructions: "?" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("http_error");
  });

  test("429 retries with backoff and eventually succeeds", async () => {
    const calls: FetchCall[] = [];
    let n = 0;
    stubFetch(calls, () => {
      n++;
      if (n < 3) return jsonResponse(429, { error: "rate limited" });
      return jsonResponse(200, { answers: { q: { type: "noul", noul: 0.4 } }, usage: {} });
    });
    const result = await askJev("s", { q: { type: "noul", instructions: "?" } });
    expect(calls).toHaveLength(3);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.answers.q).toEqual({ type: "noul", noul: 0.4 });
  });

  test("529 exhausted after max attempts fails closed as rate_limited", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => jsonResponse(529, { error: "overloaded" }));
    const result = await askJev("s", { q: { type: "noul", instructions: "?" } });
    expect(calls.length).toBeGreaterThan(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("rate_limited");
  });

  test("a network error fails closed as network_error", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const result = await askJev("s", { q: { type: "noul", instructions: "?" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("network_error");
  });

  test("an unparseable body fails closed as invalid_response", async () => {
    stubFetch([], () => new Response("not json", { status: 200 }));
    const result = await askJev("s", { q: { type: "noul", instructions: "?" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_response");
  });
});

describe("noul()", () => {
  test("returns the noul probability on success", async () => {
    stubFetch([], () =>
      jsonResponse(200, { answers: { q: { type: "noul", noul: 0.82 } }, usage: {} }),
    );
    const result = await noul("some headlines", "is there signal?");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.answer.noul).toBe(0.82);
  });
});

describe("choice()", () => {
  test("returns the pick when confidence is at or above the floor", async () => {
    stubFetch([], () =>
      jsonResponse(200, {
        answers: {
          q: {
            type: "choice",
            choice: "good_candidate",
            probabilities: { good_candidate: 0.7, maybe: 0.2, bad_candidate: 0.1 },
            confidence: 0.7,
          },
        },
        usage: {},
      }),
    );
    const result = await choice("state", "classify", {
      good_candidate: null,
      maybe: null,
      bad_candidate: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.answer.choice).toBe("good_candidate");
  });

  test("a low-confidence pick fails closed as low_confidence", async () => {
    stubFetch([], () =>
      jsonResponse(200, {
        answers: {
          q: {
            type: "choice",
            choice: "maybe",
            probabilities: { good_candidate: 0.34, maybe: 0.36, bad_candidate: 0.3 },
            confidence: JEV_MIN_CONFIDENCE - 0.01,
          },
        },
        usage: {},
      }),
    );
    const result = await choice("state", "classify", { good_candidate: null, maybe: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("low_confidence");
  });
});

describe("score()", () => {
  test("returns the score when confidence clears the floor", async () => {
    stubFetch([], () =>
      jsonResponse(200, {
        answers: {
          q: {
            type: "score",
            score: 2,
            legend: { "0": "bad_candidate", "1": "maybe", "2": "good_candidate" },
            probabilities: { "0": 0.05, "1": 0.15, "2": 0.8 },
            confidence: 0.8,
          },
        },
        usage: {},
      }),
    );
    const result = await score("state", "rate this", ["bad_candidate", "maybe", "good_candidate"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.answer.score).toBe(2);
  });
});
