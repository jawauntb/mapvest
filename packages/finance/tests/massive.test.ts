import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getAggregates,
  getCorporateEvents,
  getOptionContracts,
  getOptionsChain,
  getQuote,
} from "../src/index.js";
import { massiveClient } from "../src/marketData/massive.js";

const realFetch = globalThis.fetch;
const savedEnv = {
  key: process.env.MASSIVE_API_KEY,
  base: process.env.MASSIVE_BASE_URL,
  provider: process.env.MARKET_DATA_PROVIDER,
  retries: process.env.MASSIVE_MAX_RETRIES,
  delay: process.env.MASSIVE_RETRY_DELAY_MS,
  freshness: process.env.MASSIVE_MARKET_DATA_FRESHNESS,
  nodeEnv: process.env.NODE_ENV,
  testBase: process.env.MASSIVE_ALLOW_TEST_BASE_URL,
};

function installFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  process.env.MASSIVE_API_KEY = "test-key";
  process.env.MASSIVE_BASE_URL = "https://massive.test";
  process.env.MARKET_DATA_PROVIDER = "massive";
  process.env.MASSIVE_MAX_RETRIES = "0";
  process.env.MASSIVE_RETRY_DELAY_MS = "0";
  process.env.MASSIVE_MARKET_DATA_FRESHNESS = "real-time";
  process.env.NODE_ENV = "test";
  process.env.MASSIVE_ALLOW_TEST_BASE_URL = "1";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries({
    MASSIVE_API_KEY: savedEnv.key,
    MASSIVE_BASE_URL: savedEnv.base,
    MARKET_DATA_PROVIDER: savedEnv.provider,
    MASSIVE_MAX_RETRIES: savedEnv.retries,
    MASSIVE_RETRY_DELAY_MS: savedEnv.delay,
    MASSIVE_MARKET_DATA_FRESHNESS: savedEnv.freshness,
    NODE_ENV: savedEnv.nodeEnv,
    MASSIVE_ALLOW_TEST_BASE_URL: savedEnv.testBase,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Massive provider adapter", () => {
  test("maps a realtime snapshot into the stable quote shape", async () => {
    const calls = installFetch(() =>
      json({
        ticker: {
          day: { c: 201, t: 1_700_000_000_000 },
          prevDay: { c: 200 },
          lastTrade: { p: 202, t: 1_700_000_001_000 },
          currencyName: "USD",
        },
        status: "OK",
      }),
    );
    const quote = await getQuote("hsy");
    expect(quote).toMatchObject({
      symbol: "HSY",
      price: 202,
      change: 2,
      changePct: 1,
      provider: "massive",
      freshness: "real-time",
    });
    expect(quote?.ts).toBe(new Date(1_700_000_001_000).toISOString());
    expect(calls[0]?.url).toContain("/v2/snapshot/locale/us/markets/stocks/tickers/HSY");
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key",
    );
  });

  test("retries a rate limit and then returns the successful quote", async () => {
    process.env.MASSIVE_MAX_RETRIES = "1";
    let attempt = 0;
    const calls = installFetch(() => {
      attempt += 1;
      return attempt === 1
        ? json({ status: "ERROR", message: "slow down" }, 429, { "retry-after": "0" })
        : json({
            ticker: {
              day: { c: 101 },
              prevDay: { c: 100 },
              lastTrade: { p: 101, t: 1_700_000_001_000 },
            },
            status: "OK",
          });
    });
    const quote = await massiveClient.getQuote("ABC");
    expect(quote?.price).toBe(101);
    expect(calls).toHaveLength(2);
  });

  test("surfaces provider errors after retries are exhausted", async () => {
    installFetch(() =>
      json({ status: "ERROR", message: "upstream down", request_id: "req-1" }, 500),
    );
    await expect(massiveClient.getQuote("ABC")).rejects.toMatchObject({
      provider: "massive",
      status: 500,
      code: "upstream_error",
      requestId: "req-1",
    });
  });

  test("rejects an unsafe Massive base URL before sending the bearer token", async () => {
    process.env.MASSIVE_BASE_URL = "http://evil.example.test";
    process.env.MASSIVE_ALLOW_TEST_BASE_URL = "0";
    const fetchMock = installFetch(() => json({ status: "OK" }));
    await expect(massiveClient.getQuote("ABC")).rejects.toMatchObject({
      status: 503,
      code: "invalid_configuration",
    });
    expect(fetchMock).toHaveLength(0);
  });

  test("returns null for a snapshot with no usable price", async () => {
    installFetch(() => json({ ticker: { prevDay: { c: 100 } }, status: "OK" }));
    expect(await massiveClient.getQuote("ABC")).toBeNull();
  });

  test("uses a quote-only snapshot instead of falling back to the prior close", async () => {
    installFetch(() =>
      json({
        ticker: {
          prevDay: { c: 100 },
          lastQuote: { P: 101, p: 103, t: 1_700_000_001_000 },
        },
        status: "OK",
      }),
    );
    const quote = await massiveClient.getQuote("ABC");
    expect(quote).toMatchObject({ price: 102, change: 2 });
    expect(quote?.ts).toBe(new Date(1_700_000_001_000).toISOString());
  });

  test("uses the explicit Yahoo fallback after a null Massive quote", async () => {
    process.env.MARKET_DATA_FALLBACK_PROVIDER = "yahoo";
    let attempt = 0;
    installFetch((url) => {
      attempt += 1;
      if (url.includes("massive.test")) return json({ ticker: { prevDay: { c: 100 } } });
      return json({
        chart: {
          result: [{ meta: { symbol: "ABC", regularMarketPrice: 102, chartPreviousClose: 100 } }],
        },
      });
    });
    const quote = await getQuote("ABC");
    expect(quote?.provider).toBe("yahoo");
    expect(attempt).toBe(2);
  });

  test("maps stock aggregates to normalized OHLCV bars", async () => {
    installFetch(() =>
      json({
        status: "OK",
        results: [{ t: 1_700_000_000_000, o: 1, h: 3, l: 0.5, c: 2, v: 10, vw: 2, n: 4 }],
      }),
    );
    const result = await getAggregates({
      symbol: "ABC",
      from: "2024-01-01",
      to: "2024-01-02",
      multiplier: 1,
      timespan: "day",
    });
    expect(result).toEqual([
      {
        ts: 1_700_000_000,
        open: 1,
        high: 3,
        low: 0.5,
        close: 2,
        volume: 10,
        vwap: 2,
        transactions: 4,
      },
    ]);
  });

  test("maps options chain snapshots and preserves cursor pagination", async () => {
    installFetch(() =>
      json({
        status: "OK",
        next_url: "https://massive.test/v3/snapshot/options/AAPL?cursor=next",
        request_id: "req-chain",
        results: [
          {
            ticker: "O:AAPL260116C00100000",
            underlying_ticker: "AAPL",
            contract_type: "call",
            expiration_date: "2026-01-16",
            strike_price: 100,
            implied_volatility: 0.22,
            open_interest: 55,
            greeks: { delta: 0.5 },
            last_quote: { bid: 1, ask: 1.1, last_updated: 1_700_000_001_000_000_000 },
            last_trade: { price: 1.05, size: 2, sip_timestamp: 1_700_000_002_000_000_000 },
          },
        ],
      }),
    );
    const result = await getOptionsChain({
      underlyingTicker: "AAPL",
      expirationDate: "2026-01-16",
      limit: 1,
    });
    expect(result.nextCursor).toBe("next");
    expect(result.results[0]).toMatchObject({
      ticker: "O:AAPL260116C00100000",
      contractType: "call",
      impliedVolatility: 0.22,
      greeks: { delta: 0.5 },
      quote: { bid: 1, ask: 1.1 },
      trade: { ts: 1_700_000_002 },
    });
  });

  test("maps contracts and corporate action events", async () => {
    let call = 0;
    installFetch(() => {
      call += 1;
      if (call === 1)
        return json({
          status: "OK",
          results: [
            {
              ticker: "O:AAPL260116C00100000",
              underlying_ticker: "AAPL",
              contract_type: "call",
              expiration_date: "2026-01-16",
              strike_price: 100,
            },
          ],
        });
      if (call === 2)
        return json({
          status: "OK",
          results: [
            { ticker: "AAPL", execution_date: "2024-01-01", split_from: 1, split_to: 2 },
            { ticker: "AAPL", execution_date: "2025-01-01", split_from: 1, split_to: 2 },
          ],
        });
      return json({
        status: "OK",
        results: [{ ticker: "AAPL", ex_dividend_date: "2025-02-01", cash_amount: 0.25 }],
      });
    });
    const contracts = await getOptionContracts({ underlyingTicker: "AAPL" });
    const events = await getCorporateEvents({
      ticker: "AAPL",
      from: "2025-01-01",
      to: "2025-12-31",
    });
    expect(contracts.results[0]).toMatchObject({
      ticker: "O:AAPL260116C00100000",
      expirationDate: "2026-01-16",
      strikePrice: 100,
    });
    expect(events.map((event) => event.type).sort()).toEqual(["dividend", "split"]);
    expect(events.every((event) => event.date?.startsWith("2025"))).toBe(true);
  });
});
