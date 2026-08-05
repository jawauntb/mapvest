import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _clearQuoteCache, getQuote, parseYahooChart, QUOTE_DISCLAIMER } from "../src/quote.js";

/**
 * Minimal Yahoo v7 chart payload — only the fields getQuote consumes.
 * regularMarketTime is seconds-since-epoch (2024-01-02T15:30:00Z).
 */
function chartPayload(overrides: Record<string, unknown> = {}) {
  return {
    chart: {
      result: [
        {
          meta: {
            symbol: "HSY",
            currency: "USD",
            regularMarketPrice: 202,
            chartPreviousClose: 200,
            regularMarketTime: 1704209400,
            ...overrides,
          },
        },
      ],
      error: null,
    },
  };
}

const realFetch = globalThis.fetch;

type FetchCall = { url: string; init?: RequestInit };

function installFetchMock(
  handler: (call: FetchCall) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>,
): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const { status = 200, body } = await handler({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls };
}

describe("parseYahooChart", () => {
  test("extracts price, change, and changePct", () => {
    const q = parseYahooChart("HSY", chartPayload());
    expect(q).not.toBeNull();
    expect(q!.symbol).toBe("HSY");
    expect(q!.price).toBe(202);
    expect(q!.change).toBeCloseTo(2, 10);
    expect(q!.changePct).toBeCloseTo(1, 10); // 2 / 200 * 100
    expect(q!.currency).toBe("USD");
    expect(q!.ts).toBe(new Date(1704209400 * 1000).toISOString());
    expect(q!.disclaimer).toBe(QUOTE_DISCLAIMER);
  });

  test("falls back to previousClose when chartPreviousClose is absent", () => {
    const payload = chartPayload({ chartPreviousClose: undefined, previousClose: 100 });
    const q = parseYahooChart("X", payload);
    expect(q).not.toBeNull();
    expect(q!.change).toBeCloseTo(102, 10);
  });

  test("returns null when meta is missing", () => {
    expect(parseYahooChart("HSY", { chart: { result: [] } })).toBeNull();
    expect(parseYahooChart("HSY", { chart: { result: null } })).toBeNull();
    expect(parseYahooChart("HSY", {})).toBeNull();
  });

  test("returns null when price or prev are non-numeric", () => {
    const bad = chartPayload({ regularMarketPrice: null });
    expect(parseYahooChart("HSY", bad as never)).toBeNull();
  });

  test("guards against zero previous close (no Infinity)", () => {
    const payload = chartPayload({ chartPreviousClose: 0, regularMarketPrice: 10 });
    const q = parseYahooChart("X", payload);
    expect(q!.changePct).toBe(0);
    expect(Number.isFinite(q!.changePct)).toBe(true);
  });
});

describe("getQuote (mocked fetch)", () => {
  beforeEach(() => {
    _clearQuoteCache();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    _clearQuoteCache();
  });

  test("parses a Yahoo response into a Quote", async () => {
    installFetchMock(() => ({ body: chartPayload() }));
    const q = await getQuote("hsy");
    expect(q).not.toBeNull();
    expect(q!.symbol).toBe("HSY");
    expect(q!.price).toBe(202);
    expect(q!.change).toBeCloseTo(2, 10);
    expect(q!.disclaimer).toBe(QUOTE_DISCLAIMER);
  });

  test("normalizes symbol to uppercase and hits the correct URL", async () => {
    const { calls } = installFetchMock(() => ({ body: chartPayload() }));
    await getQuote("  hsy  ");
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toContain("/v7/finance/chart/HSY");
  });

  test("caches results for the 30s TTL window", async () => {
    const { calls } = installFetchMock(() => ({ body: chartPayload() }));
    const a = await getQuote("HSY");
    const b = await getQuote("HSY");
    expect(a).toEqual(b);
    // Only one network call — second hit was served from cache.
    expect(calls.length).toBe(1);
  });

  test("cache is per-symbol", async () => {
    const { calls } = installFetchMock(({ url }) => ({
      body: chartPayload({ symbol: url.includes("HSY") ? "HSY" : "KO" }),
    }));
    await getQuote("HSY");
    await getQuote("KO");
    expect(calls.length).toBe(2);
  });

  test("re-fetches after the TTL expires (clearing cache stands in for time travel)", async () => {
    const { calls } = installFetchMock(() => ({ body: chartPayload() }));
    await getQuote("HSY");
    _clearQuoteCache();
    await getQuote("HSY");
    expect(calls.length).toBe(2);
  });

  test("returns null on non-2xx and caches the null", async () => {
    const { calls } = installFetchMock(() => ({ status: 500, body: {} }));
    const first = await getQuote("HSY");
    const second = await getQuote("HSY");
    expect(first).toBeNull();
    expect(second).toBeNull();
    // Null result is still cached, so we only paid once for the upstream miss.
    expect(calls.length).toBe(1);
  });

  test("returns null on empty/whitespace symbol without hitting the network", async () => {
    const { calls } = installFetchMock(() => ({ body: chartPayload() }));
    expect(await getQuote("")).toBeNull();
    expect(await getQuote("   ")).toBeNull();
    expect(calls.length).toBe(0);
  });

  test("returns null (never throws) when fetch throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const q = await getQuote("HSY");
    expect(q).toBeNull();
  });
});
