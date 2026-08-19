import { afterEach, describe, expect, mock, test } from "bun:test";
import { fetchTickerNews } from "../src/lib/news-source.js";
import { __resetMarketDataRateLimit } from "../src/middleware/marketDataRateLimit.js";
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
  __resetMarketDataRateLimit();
});

function massiveEnv(): void {
  process.env.MARKET_DATA_PRIMARY = "massive";
  process.env.MARKET_DATA_PROVIDER = "massive";
  process.env.MARKET_DATA_FALLBACK_PROVIDER = "";
  process.env.MASSIVE_API_KEY = "test-key";
  process.env.MASSIVE_BASE_URL = "https://massive.test";
  process.env.NODE_ENV = "test";
  process.env.MASSIVE_ALLOW_TEST_BASE_URL = "1";
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

    const invalidDate = await marketData.fetch(
      new Request("http://test/aggregates?symbol=AAPL&from=2024-02-31"),
    );
    expect(invalidDate.status).toBe(400);

    const reversed = await marketData.fetch(
      new Request("http://test/aggregates?symbol=AAPL&from=2024-03-01&to=2024-02-01"),
    );
    expect(reversed.status).toBe(400);
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
      nextCursor: "next",
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

  test("requires a bounded range for broad market-event queries", async () => {
    const result = await marketEvents.fetch(new Request("http://test/"));
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "ticker or bounded date range required" });
  });

  test("merges optional TMX events without changing the legacy event envelope", async () => {
    massiveEnv();
    process.env.MASSIVE_CORPORATE_EVENTS_ENABLED = "1";
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stocks/v1/splits")) {
        return Promise.resolve(
          response({ results: [{ ticker: "AAPL", execution_date: "2025-01-02" }] }),
        );
      }
      if (url.includes("/stocks/v1/dividends")) {
        return Promise.resolve(response({ results: [] }));
      }
      expect(url).toContain("/tmx/v1/corporate-events");
      return Promise.resolve(
        response({
          results: [
            {
              ticker: "AAPL",
              date: "2025-01-03",
              type: "earnings_announcement_date",
              name: "Earnings",
              status: "confirmed",
              tmx_record_id: "tmx-1",
            },
          ],
        }),
      );
    }) as typeof fetch;
    const result = await marketEvents.fetch(new Request("http://test/?ticker=AAPL&limit=10"));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      tmxAvailable: true,
      events: [
        { provider: "tmx", type: "earnings_announcement_date", tmxRecordId: "tmx-1" },
        { provider: "massive", type: "split" },
      ],
    });
  });

  test("does not let unique device IDs bypass the provider-cost limiter", async () => {
    massiveEnv();
    process.env.MASSIVE_MAX_RETRIES = "0";
    globalThis.fetch = mock(() =>
      Promise.resolve(response({ status: "OK", results: [] })),
    ) as typeof fetch;
    let last: Response | undefined;
    for (let index = 0; index < 61; index += 1) {
      last = await marketData.fetch(
        new Request("http://test/aggregates?symbol=AAPL", {
          headers: { "X-Device-Id": `device-${index}` },
        }),
      );
    }
    expect(last?.status).toBe(429);
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

  test("keeps the explicit Yahoo news fallback when Massive is unconfigured", async () => {
    process.env.MASSIVE_API_KEY = "";
    process.env.MARKET_DATA_FALLBACK_PROVIDER = "yahoo";
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          "<rss><channel><item><title>Fallback headline</title><link>https://example.com/news</link><pubDate>Tue, 01 Jan 2025 00:00:00 GMT</pubDate></item></channel></rss>",
          { status: 200, headers: { "content-type": "application/xml" } },
        ),
      ),
    ) as typeof fetch;
    const result = await fetchTickerNews("FALLBACK_NEWS_TEST", 1);
    expect(result.provider).toBe("yahoo-rss");
    expect(result.items[0]?.title).toBe("Fallback headline");
  });

  test("treats a Massive ERROR envelope as a failed provider response", async () => {
    massiveEnv();
    process.env.MASSIVE_MAX_RETRIES = "0";
    globalThis.fetch = mock(() =>
      Promise.resolve(response({ status: "ERROR", error: "entitlement missing" })),
    ) as typeof fetch;
    const result = await fetchTickerNews("MASSIVE_ERROR_TEST", 1);
    expect(result.provider).toBe("error");
    expect(result.items).toEqual([]);
  });
});
