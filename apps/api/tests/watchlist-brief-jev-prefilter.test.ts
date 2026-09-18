import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _clearBriefCache, generateWatchlistBrief } from "../src/lib/watchlist-brief.js";
import type { WatchEntry } from "../src/lib/watchlist-store.js";

/**
 * Jev-gated pre-filter on the watchlist daily brief (see the module doc in
 * `watchlist-brief.ts`). Every test mocks `globalThis.fetch` — no network,
 * no real OPENROUTER_API_KEY or JEV_API_KEY needed.
 *
 * `MARKET_DATA_PRIMARY=yahoo` routes quotes/news through the RSS/yahoo path
 * so the whole pipeline (quotes, headlines, prefilter, cascade) can be
 * driven end-to-end against a single stubbed fetch.
 */

const originalFetch = globalThis.fetch;
const originalEnv = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  JEV_API_KEY: process.env.JEV_API_KEY,
  MARKET_DATA_PRIMARY: process.env.MARKET_DATA_PRIMARY,
};

function entry(ticker: string): WatchEntry {
  return { ticker, source: "manual", createdAt: "2026-01-01T00:00:00.000Z" };
}

const YAHOO_RSS = `<?xml version="1.0"?><rss><channel>
  <item><title>Widget maker beats on margins</title><link>https://example.com/a</link><pubDate>Thu, 01 Jan 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function openRouterSuccess(headline: string, body: string): Response {
  return jsonResponse(200, {
    choices: [{ message: { content: JSON.stringify({ headline, body }) } }],
  });
}

/** Wires a fetch stub that answers Yahoo RSS, OpenRouter, and Jev by URL,
 * and counts how many times each upstream was actually called. */
function stubUpstreams(opts: {
  jevNoul: number | "error" | "timeout";
  openRouterHeadline?: string;
  openRouterBody?: string;
}) {
  const calls = { openRouter: 0, jev: 0, yahoo: 0 };
  globalThis.fetch = (async (input: URL | Request | string, _init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("finance.yahoo.com/rss/headline")) {
      calls.yahoo++;
      return new Response(YAHOO_RSS, { status: 200 });
    }
    if (url === "https://api.typesafe.ai/v1/systemone") {
      calls.jev++;
      if (opts.jevNoul === "error") return jsonResponse(401, { error: "bad key" });
      if (opts.jevNoul === "timeout") {
        await new Promise((r) => setTimeout(r, 50));
        throw new DOMException("aborted", "AbortError");
      }
      return jsonResponse(200, {
        answers: { q: { type: "noul", noul: opts.jevNoul } },
        usage: { input_tokens: 5, output_tokens: 0 },
      });
    }
    if (url.includes("openrouter.ai") && url.includes("/chat/completions")) {
      calls.openRouter++;
      return openRouterSuccess(
        opts.openRouterHeadline ?? "Tape leans risk-on",
        opts.openRouterBody ?? "A generated body about the watchlist.",
      );
    }
    // Any other upstream (quote providers, etc.) — fail closed; every
    // caller of these already tolerates a failed fetch.
    return new Response("unavailable", { status: 500 });
  }) as typeof fetch;
  return calls;
}

beforeEach(() => {
  _clearBriefCache();
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.JEV_API_KEY = "test-jev-key";
  process.env.MARKET_DATA_PRIMARY = "yahoo";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _clearBriefCache();
});

describe("watchlist daily brief — Jev pre-filter", () => {
  test("generates normally the first time, with no previous brief to reuse", async () => {
    const calls = stubUpstreams({ jevNoul: 0.05, openRouterHeadline: "Day one headline" });
    const brief = await generateWatchlistBrief({
      userId: "u1",
      entries: [entry("AAPL")],
      now: new Date("2026-01-01T12:00:00.000Z"),
      notify: false,
    });
    expect(brief.headline).toBe("Day one headline");
    expect(calls.openRouter).toBe(1);
    // No previous brief existed, so Jev is never even consulted.
    expect(calls.jev).toBe(0);
  });

  test("reuses the previous brief when Jev confidently reports no new signal", async () => {
    // Day 1: establish a previous brief.
    stubUpstreams({ jevNoul: 0.5, openRouterHeadline: "Day one headline" });
    const day1 = await generateWatchlistBrief({
      userId: "u2",
      entries: [entry("AAPL")],
      now: new Date("2026-01-01T12:00:00.000Z"),
      notify: false,
    });
    expect(day1.headline).toBe("Day one headline");

    // Day 2: same watchlist, headlines batch judged confidently stale.
    const calls = stubUpstreams({ jevNoul: 0.1, openRouterHeadline: "Should never be used" });
    const day2 = await generateWatchlistBrief({
      userId: "u2",
      entries: [entry("AAPL")],
      now: new Date("2026-01-02T12:00:00.000Z"),
      notify: false,
    });
    expect(day2.headline).toBe("Day one headline");
    expect(calls.jev).toBe(1);
    expect(calls.openRouter).toBe(0);
    // generatedAt still advances even though the content is reused.
    expect(day2.generatedAt).not.toBe(day1.generatedAt);
  });

  test("falls through to generation when Jev is uncertain", async () => {
    stubUpstreams({ jevNoul: 0.5, openRouterHeadline: "Day one headline" });
    await generateWatchlistBrief({
      userId: "u3",
      entries: [entry("AAPL")],
      now: new Date("2026-01-01T12:00:00.000Z"),
      notify: false,
    });

    const calls = stubUpstreams({ jevNoul: 0.5, openRouterHeadline: "Day two headline" });
    const day2 = await generateWatchlistBrief({
      userId: "u3",
      entries: [entry("AAPL")],
      now: new Date("2026-01-02T12:00:00.000Z"),
      notify: false,
    });
    expect(day2.headline).toBe("Day two headline");
    expect(calls.openRouter).toBe(1);
  });

  test("falls through to generation when Jev errors (never suppresses on failure)", async () => {
    stubUpstreams({ jevNoul: 0.5, openRouterHeadline: "Day one headline" });
    await generateWatchlistBrief({
      userId: "u4",
      entries: [entry("AAPL")],
      now: new Date("2026-01-01T12:00:00.000Z"),
      notify: false,
    });

    const calls = stubUpstreams({ jevNoul: "error", openRouterHeadline: "Day two headline" });
    const day2 = await generateWatchlistBrief({
      userId: "u4",
      entries: [entry("AAPL")],
      now: new Date("2026-01-02T12:00:00.000Z"),
      notify: false,
    });
    expect(day2.headline).toBe("Day two headline");
    expect(calls.openRouter).toBe(1);
  });

  test("a confidently-YES read still generates rather than reusing", async () => {
    stubUpstreams({ jevNoul: 0.5, openRouterHeadline: "Day one headline" });
    await generateWatchlistBrief({
      userId: "u5",
      entries: [entry("AAPL")],
      now: new Date("2026-01-01T12:00:00.000Z"),
      notify: false,
    });

    const calls = stubUpstreams({ jevNoul: 0.9, openRouterHeadline: "Day two headline" });
    const day2 = await generateWatchlistBrief({
      userId: "u5",
      entries: [entry("AAPL")],
      now: new Date("2026-01-02T12:00:00.000Z"),
      notify: false,
    });
    expect(day2.headline).toBe("Day two headline");
    expect(calls.openRouter).toBe(1);
  });
});
