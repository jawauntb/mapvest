import { afterEach, describe, expect, mock, test } from "bun:test";
import { fetchTickerNews } from "../src/lib/news-source.js";
import { __resetMarketDataRateLimit } from "../src/middleware/marketDataRateLimit.js";
import financials from "../src/routes/financials.js";
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

  test("strictly validates additive option summary and bars inputs", async () => {
    expect((await options.fetch(new Request("http://test/summary?underlying=AAPL"))).status).toBe(
      400,
    );
    expect(
      (
        await options.fetch(
          new Request("http://test/bars?ticker=O:AAPL260116C00100000&from=2025-01-01"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await options.fetch(
          new Request(
            "http://test/bars?ticker=O:AAPL260116C00100000&from=2025-01-01&to=2025-01-02&cursor=bad%20cursor",
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await options.fetch(
          new Request(
            "http://test/bars?ticker=O:AAPL260116C00100000&from=2025-01-01&to=2025-01-02&adjusted=not-a-boolean",
          ),
        )
      ).status,
    ).toBe(400);
  });

  test("returns an additive option summary envelope", async () => {
    massiveEnv();
    globalThis.fetch = mock(() =>
      Promise.resolve(
        response({
          results: [
            {
              details: {
                ticker: "O:AAPL260116C00100000",
                underlying_ticker: "AAPL",
                contract_type: "call",
                expiration_date: "2026-01-16",
                strike_price: 100,
              },
              break_even_price: 101.25,
              implied_volatility: 0.22,
              open_interest: 55,
              last_quote: { bid: 1, ask: 1.1 },
            },
          ],
          request_id: "option-summary",
        }),
      ),
    ) as typeof fetch;

    const result = await options.fetch(
      new Request("http://test/summary?underlying=AAPL&contract=O:AAPL260116C00100000"),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      underlyingTicker: "AAPL",
      contractTicker: "O:AAPL260116C00100000",
      summary: {
        breakEvenPrice: 101.25,
        impliedVolatility: 0.22,
        quote: { bid: 1, ask: 1.1 },
      },
      sources: [{ provider: "massive" }],
    });
  });

  test("returns cursor continuation for option bars", async () => {
    massiveEnv();
    globalThis.fetch = mock(() =>
      Promise.resolve(
        response({
          results: [{ t: 1_700_000_000_000, o: 1, h: 3, l: 0.5, c: 2, v: 10 }],
          next_url: "https://massive.test/v2/aggs/ticker/O:AAPL260116C00100000?cursor=opaque-next",
          request_id: "option-bars",
        }),
      ),
    ) as typeof fetch;

    const result = await options.fetch(
      new Request(
        "http://test/bars?ticker=O:AAPL260116C00100000&from=2025-01-01&to=2025-01-02&timespan=day&cursor=opaque-in",
      ),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      contractTicker: "O:AAPL260116C00100000",
      points: [{ ts: 1_700_000_000, open: 1, high: 3, low: 0.5, close: 2 }],
      nextCursor: "opaque-next",
      requestId: "option-bars",
      sources: [{ provider: "massive" }],
    });
  });

  test("rejects invalid financial-ratios input and reports an unavailable provider", async () => {
    const missingTicker = await financials.fetch(new Request("http://test/ratios"));
    expect(missingTicker.status).toBe(400);

    massiveEnv();
    process.env.MASSIVE_MAX_RETRIES = "0";
    globalThis.fetch = mock(() =>
      Promise.resolve(response({ status: "ERROR", message: "down" }, 503)),
    ) as typeof fetch;
    const unavailable = await financials.fetch(
      new Request("http://test/ratios?ticker=AAPL&limit=1"),
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "financial ratios unavailable" });
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
    expect(await result.json()).toMatchObject({ interval: "1d", sources: [{ provider: "yahoo" }] });
  });

  test("rejects an unsupported quote-history interval", async () => {
    const result = await quoteHistory.fetch(new Request("http://test/?symbol=AAPL&interval=4h"));
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "interval must be 15m, 1d, or 1w" });
  });

  test("clamps 15m quote-history to 5d and patches the live last bar", async () => {
    massiveEnv();
    const now = Date.now();
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/range/15/minute/")) {
        expect(url).toMatch(/\/range\/15\/minute\//);
        return Promise.resolve(
          response({
            results: [
              { t: now - 900_000, c: 180 },
              { t: now, c: 181 },
            ],
          }),
        );
      }
      if (url.includes("/snapshot/")) {
        return Promise.resolve(
          response({
            ticker: {
              day: { c: 188, t: now },
              prevDay: { c: 181 },
              lastTrade: { p: 188.5, t: now },
            },
          }),
        );
      }
      return Promise.resolve(response({ error: "unexpected" }, 500));
    }) as typeof fetch;

    const result = await quoteHistory.fetch(
      new Request("http://test/?symbol=AAPL&period=1y&interval=15m"),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      ticker: "AAPL",
      period: "5d",
      interval: "15m",
      points: [{ close: 180 }, { close: 188.5 }],
      sources: [{ provider: "massive" }],
    });
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

  test("uses neutral copy when market news has no publisher", async () => {
    massiveEnv();
    globalThis.fetch = mock(() =>
      Promise.resolve(
        response({
          status: "OK",
          results: [
            {
              title: "Publisher-free headline",
              article_url: "https://example.com/publisher-free-news",
              published_utc: "2025-01-01T00:00:00Z",
            },
          ],
        }),
      ),
    ) as unknown as typeof fetch;

    const result = await fetchTickerNews("PUBLISHER_FREE_NEWS_TEST", 1);
    expect(result.items[0]?.source).toBe("Market news");
    expect(result.items[0]?.source).not.toMatch(/massive/i);
    expect(result.provider).toBe("massive");
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
