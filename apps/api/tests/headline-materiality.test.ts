import { afterEach, beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { app } from "../src/index.js";
import {
  type JevMateriality,
  MATERIALITY_BATCH_SIZE,
  _clearMaterialityCache,
  filterByMateriality,
  materialityFromAnswer,
  parseMaterialityFloor,
  scoreHeadlineMateriality,
} from "../src/lib/headline-materiality.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import { _clearNewsCache } from "../src/lib/news-source.js";
import { __resetStore } from "../src/lib/store.js";
import { _clearBriefCache } from "../src/lib/watchlist-brief.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";

/**
 * Jev materiality tags on headlines (lib/headline-materiality.ts) and the two
 * routes that carry them: `GET /v1/news` and `GET /v1/watchlist/headlines`.
 * Every test stubs `globalThis.fetch` — no network, no real JEV_API_KEY.
 * `MARKET_DATA_PRIMARY=yahoo` routes news through the RSS path so one stub
 * answers both the news provider and Jev by URL.
 */

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const originalFetch = globalThis.fetch;
const originalEnv = {
  JEV_API_KEY: process.env.JEV_API_KEY,
  MARKET_DATA_PRIMARY: process.env.MARKET_DATA_PRIMARY,
};

type JevRequest = { state: unknown; questions: Record<string, unknown> };

function rss(items: Array<{ title: string; url: string }>): string {
  return `<?xml version="1.0"?><rss><channel>${items
    .map(
      (it, i) =>
        // Descending dates so the provider's newest-first sort keeps input order.
        `<item><title>${it.title}</title><link>${it.url}</link><pubDate>Thu, ${String(28 - (i % 27)).padStart(2, "0")} Jan 2026 10:00:00 GMT</pubDate></item>`,
    )
    .join("")}</channel></rss>`;
}

function choiceAnswer(level: string, confidence: number, probabilities?: Record<string, number>) {
  return {
    type: "choice",
    choice: level,
    confidence,
    probabilities: probabilities ?? { noise: 0.1, minor: 0.2, material: 0.7 },
  };
}

/**
 * Fetch stub answering Yahoo RSS + Jev by URL. `jev` decides how each Jev
 * request is answered; it receives the parsed request body and the count of
 * Jev calls so far. Returns the recorded calls for assertions.
 */
function stubUpstreams(opts: {
  rssItems?: Array<{ title: string; url: string }>;
  jev: (req: JevRequest, call: number) => Response | Promise<Response>;
}) {
  const calls = { jev: 0, yahoo: 0, jevRequests: [] as JevRequest[] };
  globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("finance.yahoo.com/rss/headline")) {
      calls.yahoo++;
      return new Response(rss(opts.rssItems ?? []), { status: 200 });
    }
    if (url === JEV_URL) {
      calls.jev++;
      const req = JSON.parse(String(init?.body ?? "{}")) as JevRequest;
      calls.jevRequests.push(req);
      return opts.jev(req, calls.jev);
    }
    return new Response("unavailable", { status: 500 });
  }) as typeof fetch;
  return calls;
}

/** Answers every question in the request with the same choice. */
function answerAll(level: string, confidence: number) {
  return (req: JevRequest) =>
    Response.json({
      answers: Object.fromEntries(
        Object.keys(req.questions).map((id) => [id, choiceAnswer(level, confidence)]),
      ),
      usage: { input_tokens: 10, output_tokens: 0 },
    });
}

beforeEach(() => {
  __resetStore();
  __resetMetrics();
  __resetRateLimit();
  _clearBriefCache();
  _clearNewsCache();
  _clearMaterialityCache();
  process.env.JEV_API_KEY = "test-jev-key";
  process.env.MARKET_DATA_PRIMARY = "yahoo";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  // Empty string, not `delete`: falsy for every `process.env.X` read here
  // and biome's noDelete rule is satisfied.
  for (const [k, v] of Object.entries(originalEnv)) process.env[k] = v ?? "";
});

const headline = (i: number, ticker = "AAPL") => ({
  id: `https://example.com/${ticker.toLowerCase()}/${i}`,
  ticker,
  title: `Headline ${i}`,
  source: "Example Wire",
  publishedAt: "2026-01-01T10:00:00.000Z",
});

describe("materialityFromAnswer", () => {
  test("maps a confident choice to level + weighted score + confidence", () => {
    const tag = materialityFromAnswer(
      choiceAnswer("material", 0.82, { noise: 0.05, minor: 0.15, material: 0.8 }),
    );
    expect(tag).toEqual({ level: "material", score: 0.875, confidence: 0.82 });
  });

  test("drops anything below the confidence floor or malformed", () => {
    expect(materialityFromAnswer(choiceAnswer("material", 0.4))).toBeNull();
    expect(materialityFromAnswer(choiceAnswer("urgent", 0.9))).toBeNull();
    expect(materialityFromAnswer({ type: "noul", noul: 0.9 })).toBeNull();
    expect(materialityFromAnswer(null)).toBeNull();
  });

  test("falls back to the chosen level's position when probabilities are unusable", () => {
    const tag = materialityFromAnswer({
      type: "choice",
      choice: "minor",
      confidence: 0.7,
      probabilities: {},
    });
    expect(tag).toEqual({ level: "minor", score: 0.5, confidence: 0.7 });
  });
});

describe("scoreHeadlineMateriality", () => {
  test("asks ONE batched question set per page and keys results by headline id", async () => {
    const calls = stubUpstreams({ jev: answerAll("material", 0.82) });
    const items = [headline(1), headline(2), headline(3)];
    const tags = await scoreHeadlineMateriality(items, ["AAPL"]);
    expect(calls.jev).toBe(1);
    const req = calls.jevRequests[0]!;
    expect(Object.keys(req.questions)).toHaveLength(3);
    expect((req.state as { tickers: string[] }).tickers).toEqual(["AAPL"]);
    expect((req.state as { headlines: unknown[] }).headlines).toHaveLength(3);
    for (const it of items) {
      expect(tags[it.id]).toEqual({ level: "material", score: 0.8, confidence: 0.82 });
    }
  });

  test("fails open: no key, HTTP error, timeout, and low confidence all yield no tags", async () => {
    process.env.JEV_API_KEY = "";
    const noKey = stubUpstreams({ jev: answerAll("material", 0.9) });
    expect(await scoreHeadlineMateriality([headline(1)])).toEqual({});
    expect(noKey.jev).toBe(0);

    process.env.JEV_API_KEY = "test-jev-key";
    _clearMaterialityCache();
    stubUpstreams({ jev: () => Response.json({ error: "boom" }, { status: 500 }) });
    expect(await scoreHeadlineMateriality([headline(1)])).toEqual({});

    _clearMaterialityCache();
    stubUpstreams({
      jev: async () => {
        throw new DOMException("aborted", "AbortError");
      },
    });
    expect(await scoreHeadlineMateriality([headline(1)])).toEqual({});

    _clearMaterialityCache();
    stubUpstreams({ jev: answerAll("material", 0.3) });
    expect(await scoreHeadlineMateriality([headline(1)])).toEqual({});
  });

  test("a failed batch is remembered briefly so polling does not hammer Jev", async () => {
    const calls = stubUpstreams({ jev: () => Response.json({ error: "boom" }, { status: 500 }) });
    await scoreHeadlineMateriality([headline(1)]);
    await scoreHeadlineMateriality([headline(1)]);
    expect(calls.jev).toBe(1);
  });

  test("cache hit: an identical page is not re-scored, a changed title is", async () => {
    const calls = stubUpstreams({ jev: answerAll("minor", 0.7) });
    const first = await scoreHeadlineMateriality([headline(1), headline(2)]);
    const second = await scoreHeadlineMateriality([headline(1), headline(2)]);
    expect(calls.jev).toBe(1);
    expect(second).toEqual(first);

    // Same id (url), different content → new content hash → re-asked.
    await scoreHeadlineMateriality([{ ...headline(1), title: "Headline 1 (updated)" }]);
    expect(calls.jev).toBe(2);
    expect(Object.keys(calls.jevRequests[1]!.questions)).toHaveLength(1);
  });

  test("low-confidence verdicts are cached too, so they are not re-asked every poll", async () => {
    const calls = stubUpstreams({ jev: answerAll("noise", 0.2) });
    await scoreHeadlineMateriality([headline(1)]);
    await scoreHeadlineMateriality([headline(1)]);
    expect(calls.jev).toBe(1);
  });

  test("chunks pages larger than the batch size into several systemone calls", async () => {
    const calls = stubUpstreams({ jev: answerAll("noise", 0.9) });
    const items = Array.from({ length: MATERIALITY_BATCH_SIZE * 2 + 5 }, (_, i) => headline(i));
    const tags = await scoreHeadlineMateriality(items);
    expect(calls.jev).toBe(3);
    for (const req of calls.jevRequests) {
      expect(Object.keys(req.questions).length).toBeLessThanOrEqual(MATERIALITY_BATCH_SIZE);
    }
    expect(Object.keys(tags)).toHaveLength(items.length);
  });

  test("a chunk that fails leaves its items unscored while earlier chunks keep their tags", async () => {
    const calls = stubUpstreams({
      jev: (req, call) =>
        call === 1 ? answerAll("material", 0.9)(req) : Response.json({}, { status: 529 }),
    });
    const items = Array.from({ length: MATERIALITY_BATCH_SIZE + 1 }, (_, i) => headline(i));
    const tags = await scoreHeadlineMateriality(items);
    expect(Object.keys(tags)).toHaveLength(MATERIALITY_BATCH_SIZE);
    expect(tags[items[MATERIALITY_BATCH_SIZE]!.id]).toBeUndefined();
    // 1 good + 3 attempts on the 529 (client retries rate limits twice).
    expect(calls.jev).toBe(4);
  });
});

describe("filterByMateriality / parseMaterialityFloor", () => {
  const tag = (level: JevMateriality["level"]): JevMateriality => ({
    level,
    score: 0.5,
    confidence: 0.8,
  });
  const items = [
    { id: "a", jev_materiality: tag("noise") },
    { id: "b", jev_materiality: tag("minor") },
    { id: "c", jev_materiality: tag("material") },
    { id: "d" },
  ];

  test("keeps items at or above the floor AND every unscored item", () => {
    expect(filterByMateriality(items, "material").map((i) => i.id)).toEqual(["c", "d"]);
    expect(filterByMateriality(items, "minor").map((i) => i.id)).toEqual(["b", "c", "d"]);
    expect(filterByMateriality(items, "noise").map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterByMateriality(items, null)).toBe(items);
  });

  test("unknown floors are ignored rather than rejected", () => {
    expect(parseMaterialityFloor("material")).toBe("material");
    expect(parseMaterialityFloor(" Minor ")).toBe("minor");
    expect(parseMaterialityFloor("urgent")).toBeNull();
    expect(parseMaterialityFloor(undefined)).toBeNull();
  });
});

// ---------------- routes ----------------

function url(path: string) {
  return `http://localhost/v1${path}`;
}

type NewsBody = {
  items: Array<{ title: string; url: string; jev_materiality?: JevMateriality }>;
  provider: string;
  ts: string;
  materiality: string | null;
};

describe("GET /v1/news — jev_materiality", () => {
  const rssItems = [
    { title: "Acme beats on margins", url: "https://example.com/1" },
    { title: "Top 10 stocks to watch", url: "https://example.com/2" },
  ];

  test("attaches the tag per item, additively, with the floor echoed as null", async () => {
    const calls = stubUpstreams({
      rssItems,
      jev: () =>
        Response.json({
          answers: {
            h0: choiceAnswer("material", 0.82, { noise: 0.05, minor: 0.15, material: 0.8 }),
            h1: choiceAnswer("noise", 0.9, { noise: 0.9, minor: 0.08, material: 0.02 }),
          },
          usage: {},
        }),
    });
    const res = await app.fetch(new Request(url("/news?ticker=acme&limit=5")));
    expect(res.status).toBe(200);
    const body = (await res.json()) as NewsBody;
    expect(body.provider).toBe("yahoo-rss");
    expect(body.materiality).toBeNull();
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      title: "Acme beats on margins",
      url: "https://example.com/1",
      jev_materiality: { level: "material", score: 0.875, confidence: 0.82 },
    });
    expect(body.items[1]?.jev_materiality).toEqual({
      level: "noise",
      score: 0.06,
      confidence: 0.9,
    });
    expect(calls.jev).toBe(1);
    expect(Object.keys(calls.jevRequests[0]!.questions)).toEqual(["h0", "h1"]);
  });

  test("fails open: with Jev down the response shape is exactly what it was", async () => {
    stubUpstreams({ rssItems, jev: () => Response.json({ error: "down" }, { status: 503 }) });
    const res = await app.fetch(new Request(url("/news?ticker=acme")));
    expect(res.status).toBe(200);
    const body = (await res.json()) as NewsBody;
    expect(body.items).toHaveLength(2);
    for (const it of body.items) expect("jev_materiality" in it).toBe(false);
    expect(Object.keys(body.items[0]!).sort()).toEqual(["publishedAt", "source", "title", "url"]);
  });

  test("without JEV_API_KEY nothing is asked and nothing is tagged", async () => {
    process.env.JEV_API_KEY = "";
    const calls = stubUpstreams({ rssItems, jev: answerAll("material", 0.9) });
    const res = await app.fetch(new Request(url("/news?ticker=acme")));
    const body = (await res.json()) as NewsBody;
    expect(body.items).toHaveLength(2);
    expect(body.items.some((it) => it.jev_materiality)).toBe(false);
    expect(calls.jev).toBe(0);
  });

  test("?materiality=material drops known-lower items and keeps unscored ones", async () => {
    stubUpstreams({
      rssItems,
      jev: () =>
        Response.json({
          // h0 unscored (low confidence); h1 confidently noise.
          answers: { h0: choiceAnswer("material", 0.4), h1: choiceAnswer("noise", 0.95) },
        }),
    });
    const res = await app.fetch(new Request(url("/news?ticker=acme&materiality=material")));
    const body = (await res.json()) as NewsBody;
    expect(body.materiality).toBe("material");
    expect(body.items.map((it) => it.url)).toEqual(["https://example.com/1"]);
    expect(body.items[0]?.jev_materiality).toBeUndefined();
  });

  test("polling the same page re-uses the memoized tags (one Jev call total)", async () => {
    const calls = stubUpstreams({ rssItems, jev: answerAll("minor", 0.7) });
    await app.fetch(new Request(url("/news?ticker=acme")));
    const res = await app.fetch(new Request(url("/news?ticker=acme")));
    const body = (await res.json()) as NewsBody;
    expect(body.items[0]?.jev_materiality?.level).toBe("minor");
    expect(calls.jev).toBe(1);
  });
});

async function loginAs(email: string): Promise<string> {
  let captured: string | undefined;
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const m = args.join(" ").match(/token=([\w.-]+)/);
    if (m) captured = m[1];
  };
  try {
    await app.fetch(
      new Request(url("/auth/request-magic-link"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      }),
    );
  } finally {
    console.log = originalLog;
  }
  const verifyRes = await app.fetch(
    new Request(url("/auth/verify"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: captured }),
    }),
  );
  const { session } = (await verifyRes.json()) as { session: { token: string } };
  return session.token;
}

function authed(path: string, token: string, init?: RequestInit) {
  return app.fetch(
    new Request(url(path), {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    }),
  );
}

type HeadlinesBody = {
  items: Array<{ ticker: string; title: string; url: string; jev_materiality?: JevMateriality }>;
  tickers: string[];
  materiality: string | null;
  generatedAt: string;
};

describe("GET /v1/watchlist/headlines", () => {
  test("requires auth", async () => {
    const res = await app.fetch(new Request(url("/watchlist/headlines")));
    expect(res.status).toBe(401);
  });

  test("an empty watchlist is an empty feed with no Jev call", async () => {
    const calls = stubUpstreams({ jev: answerAll("material", 0.9) });
    const token = await loginAs("headlines-empty@mapvest.dev");
    const res = await authed("/watchlist/headlines", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HeadlinesBody;
    expect(body).toMatchObject({ items: [], tickers: [], materiality: null });
    expect(body.generatedAt).toEqual(expect.any(String));
    expect(calls.jev).toBe(0);
  });

  test("tags every ticker's headlines from one batched call and filters with unscored kept", async () => {
    const rssItems = [
      { title: "Guidance raised", url: "https://example.com/g" },
      { title: "Weekend reading list", url: "https://example.com/w" },
    ];
    const calls = stubUpstreams({
      rssItems,
      jev: (req) => {
        const ids = Object.keys(req.questions);
        const headlines = (req.state as { headlines: Array<{ id: string; title: string }> })
          .headlines;
        const answers: Record<string, unknown> = {};
        for (const id of ids) {
          const h = headlines.find((x) => x.id === id)!;
          answers[id] = h.title.startsWith("Guidance")
            ? choiceAnswer("material", 0.88)
            : choiceAnswer("noise", 0.5); // below the floor → unscored
        }
        return Response.json({ answers, usage: {} });
      },
    });
    const token = await loginAs("headlines-feed@mapvest.dev");
    for (const ticker of ["AAPL", "MSFT"]) {
      const add = await authed("/watchlist/add", token, {
        method: "POST",
        body: JSON.stringify({ ticker, source: "manual" }),
      });
      expect(add.status).toBe(200);
    }

    const res = await authed("/watchlist/headlines", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HeadlinesBody;
    expect([...body.tickers].sort()).toEqual(["AAPL", "MSFT"]);
    expect(body.items).toHaveLength(4);
    expect(calls.jev).toBe(1);
    expect([...(calls.jevRequests[0]!.state as { tickers: string[] }).tickers].sort()).toEqual([
      "AAPL",
      "MSFT",
    ]);
    const material = body.items.filter((it) => it.jev_materiality?.level === "material");
    expect(material.map((it) => it.title)).toEqual(["Guidance raised", "Guidance raised"]);
    expect(body.items.filter((it) => !it.jev_materiality)).toHaveLength(2);

    // Filter: the material ones stay, the unscored ones stay too (rule 1).
    const filtered = await authed("/watchlist/headlines?materiality=material", token);
    const fb = (await filtered.json()) as HeadlinesBody;
    expect(fb.materiality).toBe("material");
    expect(fb.items).toHaveLength(4);
    // Second page hit the memo — still one Jev call.
    expect(calls.jev).toBe(1);
  });

  test("fails open: Jev errors never shrink or break the feed", async () => {
    stubUpstreams({
      rssItems: [{ title: "Only headline", url: "https://example.com/only" }],
      jev: () => Response.json({ error: "down" }, { status: 500 }),
    });
    const token = await loginAs("headlines-down@mapvest.dev");
    await authed("/watchlist/add", token, {
      method: "POST",
      body: JSON.stringify({ ticker: "AAPL", source: "manual" }),
    });
    const res = await authed("/watchlist/headlines?materiality=material", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HeadlinesBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ ticker: "AAPL", title: "Only headline" });
    expect("jev_materiality" in body.items[0]!).toBe(false);
  });
});
