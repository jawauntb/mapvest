import { afterEach, describe, expect, mock, test } from "bun:test";
import marketData from "../src/routes/market-data.js";
import marketEvents from "../src/routes/market-events.js";
import options from "../src/routes/options.js";
import quoteHistory from "../src/routes/quote-history.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
  mock.restore();
});

function massiveEnv(): void {
  process.env.MARKET_DATA_PROVIDER = "massive";
  process.env.MARKET_DATA_FALLBACK_PROVIDER = "";
  process.env.MASSIVE_API_KEY = "test-key";
  process.env.MASSIVE_BASE_URL = "https://massive.test";
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("market-data additive API contracts", () => {
  test("keeps validation status and error shape stable for aggregates", async () => {
    const result = await marketData.fetch(new Request("http://test/aggregates"));
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "symbol required" });
  });

  test("normalizes Massive aggregates without changing the public point shape", async () => {
    massiveEnv();
    globalThis.fetch = mock(() =>
      Promise.resolve(
        response({
          ticker: "AAPL",
          results: [{ t: 1_700_000_000_000, o: 180, h: 182, l: 179, c: 181, v: 1_000 }],
          request_id: "agg-contract",
        }),
      ),
    ) as typeof fetch;

    const result = await marketData.fetch(
      new Request("http://test/aggregates?symbol=AAPL&from=2023-11-01&to=2023-11-30"),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      symbol: "AAPL",
      points: [{ ts: 1_700_000_000, open: 180, high: 182, low: 179, close: 181, volume: 1_000 }],
      sources: [{ provider: "massive" }],
    });
  });

  test("exposes options chain pagination and preserves missing-underlying validation", async () => {
    const missing = await options.fetch(new Request("http://test/chain"));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "underlying required" });

    massiveEnv();
    globalThis.fetch = mock(() =>
      Promise.resolve(
        response({
          results: [
            {
              details: {
                ticker: "O:AAPL241220C00180000",
                underlying_ticker: "AAPL",
                contract_type: "call",
                expiration_date: "2024-12-20",
                strike_price: 180,
              },
              last_quote: { bid: 1, ask: 2 },
            },
          ],
          next_url: "https://massive.test/v3/snapshot/options/AAPL?cursor=next",
          request_id: "options-contract",
        }),
      ),
    ) as typeof fetch;
    const result = await options.fetch(
      new Request("http://test/chain?underlying=AAPL&expiration_date=2024-12-20&limit=1"),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      underlyingTicker: "AAPL",
      contracts: [
        {
          ticker: "O:AAPL241220C00180000",
          underlyingTicker: "AAPL",
          contractType: "call",
          expirationDate: "2024-12-20",
          strikePrice: 180,
          quote: { bid: 1, ask: 2 },
        },
      ],
      nextUrl: "https://massive.test/v3/snapshot/options/AAPL?cursor=next",
    });
  });

  test("maps provider rate limits to the API's stable 429 error", async () => {
    massiveEnv();
    globalThis.fetch = mock(() =>
      Promise.resolve(response({ status: "ERROR" }, 429)),
    ) as typeof fetch;
    const result = await marketEvents.fetch(new Request("http://test/?ticker=AAPL"));
    expect(result.status).toBe(429);
    expect(await result.json()).toEqual({ error: "market data rate limited" });
  });

  test("uses the explicit Yahoo history fallback and cites the actual provider", async () => {
    massiveEnv();
    process.env.MARKET_DATA_FALLBACK_PROVIDER = "yahoo";
    process.env.MASSIVE_MAX_RETRIES = "0";
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("massive.test")) return Promise.resolve(response({ error: "down" }, 503));
      return Promise.resolve(
        response({
          chart: {
            result: [
              {
                timestamp: [1_700_000_000, 1_700_086_400],
                indicators: { adjclose: [{ adjclose: [180, 181] }] },
              },
            ],
          },
        }),
      );
    }) as typeof fetch;

    const result = await quoteHistory.fetch(new Request("http://test/?symbol=AAPL&period=1mo"));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ sources: [{ provider: "yahoo" }] });
  });
});
