import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  PrismBuildRequest,
  PrismChatRequest,
  PrismChatResponse,
  PrismPacket,
  PrismRecommendation,
  PrismSummary,
} from "@mapvest/core";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";
process.env.DERIVATION_RESEARCH_API_ORIGIN = "https://console.example.test";
process.env.DERIVATION_RESEARCH_SERVICE_TOKEN = "test-console-service-token";
process.env.DERIVATION_RESEARCH_POLL_INTERVAL_MS = "1";
process.env.DERIVATION_RESEARCH_POLL_TIMEOUT_MS = "500";

import { app } from "../src/index.js";
import { __resetEntitlements } from "../src/lib/entitlements.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import {
  PRISM_BUILD_TIMEOUT_MS,
  PRISM_SUMMARY_TIMEOUT_MS,
  PRISM_UPSTREAM_URL,
  __resetPrismSummaryCache,
  normalizePrismChatResponse,
  normalizePrismExportFormat,
  normalizePrismTicker,
  prismSummaryForPrompt,
  renderPrismSummary,
} from "../src/lib/prism.js";
import { buildResearchPrompt } from "../src/lib/research-agent.js";
import { __resetResearchConversationStore } from "../src/lib/research-conversation-store.js";
import { __resetStore } from "../src/lib/store.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";
import { PRISM_CHAT_LIMIT, __resetPrismChatLimit } from "../src/routes/prism.js";

// `lib/underlying.ts` freezes the origin at module load, and ES imports are
// hoisted above these assignments, so the suite targets whatever origin the
// process actually resolved rather than trying to set UNDERLYING_URL here.
const ENGINE = PRISM_UPSTREAM_URL;
const DEVICE = "device-prism-test";

type FetchCall = { url: string; method: string; body?: unknown };

const originalFetch = globalThis.fetch;

function urlOf(input: URL | Request | string): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

/**
 * Installs a fetch stub and records every upstream call. `handler` returns
 * `undefined` to fall through to a loud 599, mirroring the pattern in
 * apps/api/tests/derivation.test.ts's sibling agent-conversation suite.
 */
function stubFetch(
  calls: FetchCall[],
  handler: (url: string, init: RequestInit | undefined) => Response | undefined,
): void {
  globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
    const url = urlOf(input);
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method: init?.method ?? "GET", body });
    return handler(url, init) ?? new Response(`unexpected fetch ${url}`, { status: 599 });
  }) as typeof fetch;
}

function packet(ticker: string): Record<string, unknown> {
  return {
    ticker,
    as_of: "2026-09-01",
    generated_at: "2026-09-01T12:00:00.000Z",
    engine_version: "1.0.0",
    name: "Prism",
    profile: { name: "NVIDIA Corp", sector: "Technology", related_etfs: ["SOXX", "XLK"] },
    universe: [
      { symbol: "SPY", label: "S&P 500", role: "index", provider: "massive", n_days: 2707 },
    ],
    seasonality: { month: 9, month_label: "September" },
    macro: { vix: { series_id: "VIXCLS", provider: "fred", current: 17.2 } },
    relational: { reference_frame: "excess_over_SPY_zscored" },
    factors: { model: "fama_french_5_mom" },
    regimes: { trained_on: "SPY", n_states: 3 },
    entropy: { bins: 10 },
    spectral: { detrend: "log_price_linear" },
    eigen: { feature_names: ["spy_ret"] },
    fundamentals: { ratios: { pe: 41.2 } },
    filings: null,
    filings_error: "SEC EDGAR rate limited",
    volatility: { realized: {} },
    levels: { key_levels: [] },
    news: { items: [] },
    recent: { last_20d: { return: 0.034 } },
    scenarios: {
      method: "weighted_mixture",
      weights: { seasonality: 0.2, regime: 0.4, factors: 0.4 },
      cases: {
        bull: {
          probability: 0.3,
          narrative: "Datacenter demand holds.",
          horizons: { "1m": { expected_return: 0.08, p10: 0.01, p50: 0.08, p90: 0.16 } },
        },
        neutral: { probability: 0.5, narrative: "Range-bound.", horizons: {} },
        bear: { probability: 0.2, narrative: "Capex digestion.", horizons: {} },
      },
      entry: { bargain_below: 120.5, fair_value: 141.0, expensive_above: 165.2 },
    },
    memo: {
      recommendation: {
        action: "buy",
        strength: "normal",
        conviction: 0.62,
        one_line: "Own the compute bottleneck while the regime stays bull.",
      },
      entry_price: 132.4,
      text: "# Prism memo\n\nNot investment advice.",
      citations: [{ id: "c1", claim: "VIX at 17.2", source: "fred" }],
    },
    sources: [{ provider: "massive", fetched_at: "2026-09-01T11:59:00.000Z", confidence: "high" }],
    meta: {
      errors: [{ source: "sec", error: "rate limited" }],
      source_status: { massive: "ok", fred: "ok", sec: "error" },
      timings_ms: { total: 91234 },
      cache: { benchmarks: "hit", macro: "miss" },
    },
  };
}

/**
 * The bounded projection `GET /api/prism/{ticker}/summary` actually returns —
 * `app/prism/engine.py::prism_summary()`. Trimmed, but every key and every
 * null below is copied from a real SPY response. Note there is no `text` key.
 */
function engineSummary(): Record<string, unknown> {
  return {
    ticker: "SPY",
    as_of: "2026-09-01",
    generated_at: "2026-09-01T23:22:33.255432+00:00",
    engine_version: "1.0.0",
    name: "State Street SPDR S&P 500 ETF Trust",
    sector: null,
    industry: null,
    recommendation: null,
    one_line: null,
    entry_price: null,
    exit_targets: [],
    key_determinants: [],
    priced_in: [],
    scenarios: {
      probability_horizon: "3m",
      weights: { regime: 0.4 },
      cases: {
        bull: { probability: 0.174, narrative: "…" },
        neutral: { probability: 0.665, narrative: "…" },
        bear: { probability: 0.161, narrative: "…" },
      },
      entry: {
        bargain_below: 768.8912834692343,
        fair_value: 798.328864681132,
        expensive_above: 831.8783747453223,
        current_price: 761.69,
      },
      timing: { this_month: "neutral", reason: "September has closed higher 50% of the time" },
      watch_signals: [],
    },
    regime: { state: 0, label: "bull", days_in_regime: 8, switch_confidence: 0.9997 },
    entropy_3m: { H: 0.9868, classification: "noise", n: 63 },
    memo_excerpt: "Prism read SPY as range-bound.",
    unavailable_sections: ["memo"],
    errors: [],
    disclaimer: "Research only. This is not investment advice and no order was placed.",
  };
}

function request(path: string, body?: unknown, method?: string): Request {
  return new Request(`http://localhost/v1${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      Accept: "application/json",
      "X-Device-Id": DEVICE,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function remainingQuota(): Promise<number> {
  const res = await app.fetch(request("/entitlements"));
  const json = (await res.json()) as { remaining: number };
  return json.remaining;
}

beforeEach(() => {
  __resetRateLimit();
  __resetMetrics();
  __resetEntitlements();
  __resetStore();
  __resetResearchConversationStore();
  __resetPrismSummaryCache();
  __resetPrismChatLimit();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("prism schemas", () => {
  test("PrismPacket parses a full packet and keeps unknown keys and *_error siblings", () => {
    const parsed = PrismPacket.parse(packet("NVDA"));
    expect(parsed.ticker).toBe("NVDA");
    expect(parsed.memo?.recommendation.action).toBe("buy");
    expect(parsed.scenarios?.cases.bull.probability).toBe(0.3);
    expect(parsed.meta.errors[0]?.source).toBe("sec");
    expect((parsed as Record<string, unknown>).filings_error).toBe("SEC EDGAR rate limited");
  });

  test("PrismPacket accepts null sections but not a missing one", () => {
    const nulled = { ...packet("MU"), macro: null, spectral: null, memo: null, scenarios: null };
    expect(PrismPacket.safeParse(nulled).success).toBe(true);

    const { macro: _dropped, ...missing } = packet("MU");
    expect(PrismPacket.safeParse(missing).success).toBe(false);
  });

  test("analytical sections are loose — a new engine field survives parsing", () => {
    const grown = packet("NVDA") as Record<string, unknown>;
    grown.entropy = { bins: 10, transfer_entropy: { spy: 0.11 } };
    const parsed = PrismPacket.parse(grown);
    expect((parsed.entropy as Record<string, unknown>)?.transfer_entropy).toEqual({ spy: 0.11 });
  });

  test("the recommendation grammar is strict", () => {
    expect(
      PrismRecommendation.safeParse({
        action: "accumulate",
        strength: "normal",
        conviction: 0.5,
        one_line: "x",
      }).success,
    ).toBe(false);
    expect(
      PrismRecommendation.safeParse({
        action: "buy",
        strength: "normal",
        conviction: 1.4,
        one_line: "x",
      }).success,
    ).toBe(false);
    expect(
      PrismRecommendation.safeParse({
        action: "buy",
        strength: "normal",
        conviction: 0.5,
        one_line: "x",
        extra: true,
      }).success,
    ).toBe(false);
  });

  test("scenarios.cases is strict about the three-way split", () => {
    const drifted = packet("NVDA") as Record<string, unknown>;
    const scenarios = drifted.scenarios as Record<string, unknown>;
    scenarios.cases = { ...(scenarios.cases as object), sideways: { probability: 0.1 } };
    expect(PrismPacket.safeParse(drifted).success).toBe(false);
  });

  /**
   * Reconciliation (I2). These four shapes were pinned tighter than the engine
   * actually is; each case below was taken from a real packet produced by
   * `app/prism/engine.py` and would have failed `PrismPacket.parse` before.
   */
  test("PrismPacket parses the shapes a real engine packet actually carries", () => {
    const real = packet("SPY") as Record<string, unknown>;
    // 1. `meta` is bookkeeping, not a contract: contract.py::empty_meta() also
    //    emits `unavailable` and `notes`, engine.py appends a `stored` record,
    //    and the series cache writes numeric hit/miss counters next to the
    //    "hit"/"miss" strings.
    real.meta = {
      errors: [],
      source_status: { massive: "available" },
      timings_ms: { total: 91234 },
      cache: { packet: "miss", series: "hit", hits: 12, misses: 3 },
      unavailable: [{ source: "exa", error: "no key" }],
      notes: ["benchmarks reused from cache"],
      stored: { ticker: "SPY", local_path: "/tmp/p.json", supabase_id: null, errors: [] },
    };
    // 2. An ETF has no sector/industry/description — the keys are present and null.
    real.profile = {
      name: "State Street SPDR S&P 500 ETF Trust",
      sector: null,
      industry: null,
      description: null,
      market_cap: null,
    };
    // 3. Provenance rows score confidence numerically and have no url when the
    //    source is an API call rather than a document.
    real.sources = [{ provider: "massive", url: null, confidence: 0.9 }];
    // 4. A horizon with no surviving component forecast yields a null probability.
    const scenarios = real.scenarios as Record<string, unknown>;
    const cases = scenarios.cases as Record<string, Record<string, unknown>>;
    cases.bear = { ...cases.bear, probability: null };

    const parsed = PrismPacket.safeParse(real);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.meta.cache.hits).toBe(12);
    expect(parsed.data.profile?.sector).toBeNull();
    expect(parsed.data.sources[0]?.confidence).toBe(0.9);
    expect(parsed.data.scenarios?.cases.bear.probability).toBeNull();
  });

  /**
   * The engine is being recalibrated while these clients ship: entropy windows
   * gain `bin_grid` / `sigma_full_sample` / `H_quantile`, and each scenario
   * component gains a `shrinkage` block and `clamp_bounds`. Both live under
   * passthrough sections, so this asserts the posture rather than the fields —
   * a recalibrated packet must parse, and the new keys must survive.
   */
  test("the recalibrated engine's new section fields parse and survive", () => {
    const real = packet("NVDA") as Record<string, unknown>;
    real.entropy = {
      bins: 10,
      windows: {
        "3m": {
          H: 0.87,
          classification: "noise",
          n: 63,
          bin_grid: "full_sample_quantiles",
          sigma_full_sample: 0.0312,
          H_quantile: 0.94,
        },
      },
    };
    const scenarios = real.scenarios as Record<string, unknown>;
    scenarios.components = {
      seasonality: {
        component: "seasonality",
        available: true,
        expected_return: { "3m": 0.0629 },
        shrinkage: {
          raw_expected_return: { "3m": 0.1269 },
          prior: { "3m": 0.02 },
          shrink_weight: { "3m": 0.6 },
          expected_return: { "3m": 0.0629 },
        },
        clamp_bounds: { "3m": [-0.6, 0.6] },
      },
    };

    const parsed = PrismPacket.safeParse(real);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const windows = (parsed.data.entropy as Record<string, Record<string, unknown>>).windows;
    expect((windows["3m"] as Record<string, unknown>).H_quantile).toBe(0.94);
    const components = (parsed.data.scenarios as unknown as Record<string, unknown>)
      .components as Record<string, Record<string, unknown>>;
    expect(components.seasonality?.shrinkage).toEqual({
      raw_expected_return: { "3m": 0.1269 },
      prior: { "3m": 0.02 },
      shrink_weight: { "3m": 0.6 },
      expected_return: { "3m": 0.0629 },
    });
    expect(components.seasonality?.clamp_bounds).toEqual({ "3m": [-0.6, 0.6] });
  });

  test("a chat turn answered from the stored memo has a null model", () => {
    // The engine sets model: null when no ANTHROPIC_API_KEY is configured and it
    // replays the stored memo instead of generating a new answer.
    const parsed = PrismChatResponse.safeParse({
      ticker: "SPY",
      reply: "The chat model is not available, so this is the stored memo.",
      conversationId: "43725426-73b7-4e08-bd83-01b45a5fd7db",
      citations: [],
      model: null,
      generatedAt: "2026-09-01T23:49:33.059871+00:00",
      method: "stored_memo",
    });
    expect(parsed.success).toBe(true);
  });

  test("the memo still parses when the deterministic fallback ran (no model)", () => {
    const real = packet("SPY") as Record<string, unknown>;
    real.memo = {
      recommendation: {
        action: "hold",
        strength: "weak",
        conviction: 0.12,
        one_line: "No edge either way.",
      },
      // fallback_memo() sets model to null and cites packet sections, not URLs.
      model: null,
      generated_at: "2026-09-01T23:24:00+00:00",
      citations: [{ id: "c1", claim: "regime is bull", source: "regimes", url: null }],
      exit_targets: [{ horizon: "6m", price: null, probability: null }],
    };
    expect(PrismPacket.safeParse(real).success).toBe(true);
  });

  test("PrismSummary parses the engine's projection, which has no `text` key", () => {
    const parsed = PrismSummary.safeParse(engineSummary());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.text).toBeUndefined();
    expect(parsed.data.memo_excerpt).toBe("Prism read SPY as range-bound.");
    expect(parsed.data.recommendation).toBeNull();
  });

  test("request schemas bound their inputs", () => {
    expect(PrismBuildRequest.safeParse({ ticker: "NVDA", force: true }).success).toBe(true);
    expect(PrismBuildRequest.safeParse({}).success).toBe(false);
    expect(PrismChatRequest.safeParse({ ticker: "NVDA", message: "" }).success).toBe(false);
    expect(
      PrismChatRequest.safeParse({
        ticker: "NVDA",
        message: "why bull?",
        history: [{ role: "user", content: "hi" }],
      }).success,
    ).toBe(true);
  });
});

describe("prism upstream client helpers", () => {
  test("a cold build gets the full 180s budget", () => {
    expect(PRISM_BUILD_TIMEOUT_MS).toBe(180_000);
    expect(PRISM_SUMMARY_TIMEOUT_MS).toBe(3_000);
  });

  test("normalizePrismTicker uppercases, accepts crypto/FX pairs, and rejects junk", () => {
    expect(normalizePrismTicker(" nvda ")).toBe("NVDA");
    expect(normalizePrismTicker("X:BTCUSD")).toBe("X:BTCUSD");
    expect(normalizePrismTicker("C:EURUSD")).toBe("C:EURUSD");
    expect(normalizePrismTicker("BRK.B")).toBe("BRK.B");
    expect(normalizePrismTicker("../../etc/passwd")).toBeNull();
    expect(normalizePrismTicker("NVDA?force=1")).toBeNull();
    expect(normalizePrismTicker("")).toBeNull();
    expect(normalizePrismTicker(undefined)).toBeNull();
  });

  test("normalizePrismExportFormat defaults to txt and rejects anything else", () => {
    expect(normalizePrismExportFormat(undefined)).toBe("txt");
    expect(normalizePrismExportFormat("PDF")).toBe("pdf");
    expect(normalizePrismExportFormat("docx")).toBeNull();
  });

  test("normalizePrismChatResponse maps snake_case onto the camelCase contract", () => {
    const normalized = normalizePrismChatResponse(
      {
        reply: "Because the regime posterior is bull.",
        conversation_id: "chat_1",
        generated_at: "2026-09-01T12:05:00.000Z",
        model: "claude-opus-4-8",
        citations: [{ id: "regimes.current" }],
        extra_engine_field: 7,
      },
      "NVDA",
    );
    expect(normalized).toMatchObject({
      ticker: "NVDA",
      reply: "Because the regime posterior is bull.",
      conversationId: "chat_1",
      generatedAt: "2026-09-01T12:05:00.000Z",
      model: "claude-opus-4-8",
    });
    expect(normalized.citations[0]?.id).toBe("regimes.current");
    expect((normalized as Record<string, unknown>).extra_engine_field).toBe(7);
    expect((normalized as Record<string, unknown>).conversation_id).toBeUndefined();
  });

  test("renderPrismSummary prefers text, then serializes an object", () => {
    expect(renderPrismSummary({ text: " packet digest " })).toBe("packet digest");
    expect(renderPrismSummary("raw digest")).toBe("raw digest");
    // Nothing recognisable in the projection — fall back to raw JSON rather
    // than injecting a header line and nothing else.
    expect(renderPrismSummary({ ticker: "NVDA" })).toBe('{"ticker":"NVDA"}');
    expect(renderPrismSummary({})).toBeUndefined();
    expect(renderPrismSummary(null)).toBeUndefined();
  });

  test("renderPrismSummary renders the engine projection as lines, not JSON", () => {
    const rendered = renderPrismSummary(engineSummary());
    expect(rendered).toBeDefined();
    if (!rendered) return;
    // The projection has no `text` key, so the old JSON.stringify fallback used
    // to spend the whole 6k budget on punctuation. It must read as prose now.
    expect(rendered.startsWith("{")).toBe(false);
    expect(rendered).toContain("Prism packet: SPY as of 2026-09-01");
    expect(rendered).toContain("Scenarios (3m): bull 17.4%, neutral 66.5%, bear 16.1%");
    expect(rendered).toContain("Regime: bull (8 days in)");
    expect(rendered).toContain("3m entropy: noise");
    expect(rendered).toContain("Memo excerpt: Prism read SPY as range-bound.");
    expect(rendered).toContain("Sections unavailable: memo");
    // Canonical bull → neutral → bear order regardless of the engine's key order.
    const shuffled = engineSummary();
    const scenarios = shuffled.scenarios as Record<string, unknown>;
    const cases = scenarios.cases as Record<string, unknown>;
    scenarios.cases = { bear: cases.bear, bull: cases.bull, neutral: cases.neutral };
    expect(renderPrismSummary(shuffled)).toContain(
      "Scenarios (3m): bull 17.4%, neutral 66.5%, bear 16.1%",
    );
    // Prices are rounded — a prompt does not need 768.8912834692343.
    expect(rendered).toContain("bargain below 768.89");
    expect(rendered).not.toContain("768.8912834692343");
    expect(rendered.length).toBeLessThan(1200);
  });

  test("renderPrismSummary states the recommendation when the packet has a memo", () => {
    const withMemo = {
      ...engineSummary(),
      recommendation: {
        action: "buy",
        strength: "normal",
        conviction: 0.62,
        one_line: "Own the compute bottleneck.",
      },
      one_line: "Own the compute bottleneck.",
    };
    const rendered = renderPrismSummary(withMemo) ?? "";
    expect(rendered).toContain("Recommendation: buy (normal), conviction 62.0%");
    expect(rendered).toContain("Thesis: Own the compute bottleneck.");
  });
});

describe("POST /v1/prism", () => {
  test("forwards the build to the engine, returns the packet verbatim, and meters it", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, (url) =>
      url === `${ENGINE}/api/prism` ? Response.json(packet("NVDA")) : undefined,
    );

    expect(await remainingQuota()).toBe(50);
    const res = await app.fetch(
      request("/prism", { ticker: "nvda", force: true, includeMemo: false }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(PrismPacket.safeParse(body).success).toBe(true);
    expect(body.ticker).toBe("NVDA");

    const build = calls.find((call) => call.url === `${ENGINE}/api/prism`);
    expect(build?.method).toBe("POST");
    // Uppercased ticker + the engine's snake_case flag spelling.
    expect(build?.body).toEqual({ ticker: "NVDA", force: true, include_memo: false });
    expect(await remainingQuota()).toBe(49);
  });

  test("accepts the engine's include_memo spelling from the caller too", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json(packet("MU")));
    const res = await app.fetch(request("/prism", { ticker: "MU", include_memo: false }));
    expect(res.status).toBe(200);
    expect(calls[0]?.body).toEqual({ ticker: "MU", include_memo: false });
  });

  test("rejects a missing or unusable ticker before touching the engine", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json(packet("NVDA")));

    const missing = await app.fetch(request("/prism", {}));
    expect(missing.status).toBe(400);
    expect((await missing.json()) as unknown).toMatchObject({ code: "prism_bad_request" });

    const bad = await app.fetch(request("/prism", { ticker: "not a ticker" }));
    expect(bad.status).toBe(400);

    expect(calls).toHaveLength(0);
    expect(await remainingQuota()).toBe(50);
  });

  test("requires an identity for the metered build", async () => {
    stubFetch([], () => Response.json(packet("NVDA")));
    const res = await app.fetch(
      new Request("http://localhost/v1/prism", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: "NVDA" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("a repeat build of the same ticker on the same day meters once", async () => {
    const calls: FetchCall[] = [];
    // The engine short-circuits a non-forced rebuild and hands back today's
    // stored packet with `meta.cache.packet: "hit"` — no provider calls, no
    // Anthropic call, no cost. Charging for that would let a polling client
    // burn its whole free tier on cache hits.
    stubFetch(calls, () => {
      const body = packet("NVDA") as Record<string, unknown>;
      (body.meta as Record<string, unknown>).cache = { packet: "hit" };
      return Response.json(body);
    });

    expect((await app.fetch(request("/prism", { ticker: "NVDA" }))).status).toBe(200);
    expect(await remainingQuota()).toBe(49);

    expect((await app.fetch(request("/prism", { ticker: "nvda" }))).status).toBe(200);
    expect((await app.fetch(request("/prism", { ticker: "NVDA" }))).status).toBe(200);
    expect(await remainingQuota()).toBe(49);

    // A different ticker is a different build and is charged for.
    expect((await app.fetch(request("/prism", { ticker: "MU" }))).status).toBe(200);
    expect(await remainingQuota()).toBe(48);
  });

  test("a forced rebuild is charged every time", async () => {
    stubFetch([], () => Response.json(packet("NVDA")));

    await app.fetch(request("/prism", { ticker: "NVDA" }));
    expect(await remainingQuota()).toBe(49);
    await app.fetch(request("/prism", { ticker: "NVDA", force: true }));
    expect(await remainingQuota()).toBe(48);
    await app.fetch(request("/prism", { ticker: "NVDA", force: true }));
    expect(await remainingQuota()).toBe(47);
  });

  test("an engine failure is a 502 that does not burn quota", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json({ error: "engine exploded" }, { status: 500 }));

    const res = await app.fetch(request("/prism", { ticker: "NVDA" }));
    expect(res.status).toBe(502);
    expect((await res.json()) as unknown).toMatchObject({
      code: "prism_upstream_failed",
      upstreamStatus: 500,
    });
    expect(await remainingQuota()).toBe(50);
  });

  test("engine back-pressure is forwarded with its Retry-After", async () => {
    stubFetch([], () =>
      Response.json(
        { error: "prism build concurrency reached" },
        { status: 429, headers: { "Retry-After": "30" } },
      ),
    );
    const res = await app.fetch(request("/prism", { ticker: "NVDA" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect((await res.json()) as unknown).toMatchObject({ code: "prism_busy" });
    expect(await remainingQuota()).toBe(50);
  });

  test("an unreachable engine is a 502, not a crash", async () => {
    stubFetch([], () => {
      throw new Error("connect ECONNREFUSED");
    });
    const res = await app.fetch(request("/prism", { ticker: "NVDA" }));
    expect(res.status).toBe(502);
    expect((await res.json()) as unknown).toMatchObject({ code: "prism_upstream_failed" });
  });
});

describe("GET /v1/prism/:ticker", () => {
  test("returns the latest stored packet", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, (url) =>
      url === `${ENGINE}/api/prism/NVDA` ? Response.json(packet("NVDA")) : undefined,
    );
    const res = await app.fetch(request("/prism/nvda"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).ticker).toBe("NVDA");
    expect(calls[0]?.method).toBe("GET");
  });

  test("an unbuilt ticker is a 404 that tells the client how to build one", async () => {
    stubFetch([], () => Response.json({ error: "no packet" }, { status: 404 }));
    const res = await app.fetch(request("/prism/NVDA"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("prism_packet_not_found");
  });

  test("reading a packet is free", async () => {
    stubFetch([], () => Response.json(packet("NVDA")));
    await app.fetch(request("/prism/NVDA"));
    expect(await remainingQuota()).toBe(50);
  });

  test("GET /v1/prism describes the surface without calling the engine", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json(packet("NVDA")));
    const res = await app.fetch(request("/prism"));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({ name: "Prism", alias: "ubermemo" });
    expect(calls).toHaveLength(0);
  });
});

describe("GET /v1/prism/:ticker/summary", () => {
  test("proxies the bounded agent projection", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, (url) =>
      url === `${ENGINE}/api/prism/NVDA/summary`
        ? Response.json({ ticker: "NVDA", text: "NVDA · buy (normal), conviction 0.62" })
        : undefined,
    );
    const res = await app.fetch(request("/prism/NVDA/summary"));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({ ticker: "NVDA" });
  });

  test("an invalid ticker never reaches the engine", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json({}));
    const res = await app.fetch(request("/prism/lower%20case%20junk/summary"));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("POST /v1/prism/chat", () => {
  test("normalizes the engine turn and is not routed to GET /:ticker", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, (url) =>
      url === `${ENGINE}/api/prism/chat`
        ? Response.json({
            reply: "The bull case rests on the regime posterior.",
            conversation_id: "chat_9",
            generated_at: "2026-09-01T12:05:00.000Z",
            citations: [{ id: "regimes.current", claim: "posterior 0.71 bull" }],
          })
        : undefined,
    );

    const res = await app.fetch(
      request("/prism/chat", {
        ticker: "nvda",
        message: "Why is the bull case weighted at 0.3?",
        conversationId: "chat_9",
        history: [{ role: "user", content: "hi" }],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ticker: "NVDA", conversationId: "chat_9" });
    expect(body.reply).toContain("regime posterior");

    expect(calls[0]?.body).toEqual({
      ticker: "NVDA",
      message: "Why is the bull case weighted at 0.3?",
      conversation_id: "chat_9",
      history: [{ role: "user", content: "hi" }],
    });
    // A chat turn is not a generation: it produces no new analysis, and the
    // packet build it questions was already paid for. Its own upstream cost is
    // bounded by the per-identity turn cap instead.
    expect(await remainingQuota()).toBe(50);
  });

  test("rejects an empty message", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json({ reply: "x" }));
    const res = await app.fetch(request("/prism/chat", { ticker: "NVDA", message: "" }));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test("requires an identity — the Anthropic turn has to be attributable", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json({ reply: "x" }));
    const res = await app.fetch(
      new Request("http://localhost/v1/prism/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: "NVDA", message: "why?" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test("caps chat turns per identity — a turn costs an upstream LLM call", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json({ reply: "ok" }));

    for (let i = 0; i < PRISM_CHAT_LIMIT; i++) {
      const ok = await app.fetch(request("/prism/chat", { ticker: "NVDA", message: `q${i}` }));
      expect(ok.status).toBe(200);
    }
    expect(calls).toHaveLength(PRISM_CHAT_LIMIT);

    const refused = await app.fetch(
      request("/prism/chat", { ticker: "NVDA", message: "one more" }),
    );
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBeTruthy();
    expect((await refused.json()) as unknown).toMatchObject({ code: "prism_chat_rate_limited" });
    // The refused turn never reached the engine, so it never reached Anthropic.
    expect(calls).toHaveLength(PRISM_CHAT_LIMIT);

    // A different device has its own window.
    const other = await app.fetch(
      new Request("http://localhost/v1/prism/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Device-Id": "device-prism-other",
        },
        body: JSON.stringify({ ticker: "NVDA", message: "why?" }),
      }),
    );
    expect(other.status).toBe(200);
  });

  test("chatting about an unbuilt ticker surfaces the engine 404", async () => {
    stubFetch([], () => Response.json({ error: "no packet for NVDA" }, { status: 404 }));
    const res = await app.fetch(request("/prism/chat", { ticker: "NVDA", message: "why?" }));
    expect(res.status).toBe(404);
    expect((await res.json()) as unknown).toMatchObject({ code: "prism_packet_not_found" });
  });
});

describe("GET /v1/prism/:ticker/export", () => {
  test("streams text with a download filename", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, (url) =>
      url.startsWith(`${ENGINE}/api/prism/NVDA/export`)
        ? new Response("PRISM PACKET — NVDA\n", {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        : undefined,
    );

    const res = await app.fetch(request("/prism/NVDA/export?format=txt"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="prism-NVDA.txt"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).toContain("PRISM PACKET");
    expect(calls[0]?.url).toBe(`${ENGINE}/api/prism/NVDA/export?format=txt`);
  });

  test("streams pdf bytes through unchanged", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    stubFetch(
      [],
      () =>
        new Response(bytes, {
          headers: { "Content-Type": "application/pdf", "Content-Length": String(bytes.length) },
        }),
    );
    const res = await app.fetch(request("/prism/NVDA/export?format=pdf"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="prism-NVDA.pdf"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  test("defaults to txt and honours an upstream Content-Disposition", async () => {
    const calls: FetchCall[] = [];
    stubFetch(
      calls,
      () =>
        new Response("body", {
          headers: {
            "Content-Type": "text/plain",
            "Content-Disposition": 'attachment; filename="prism-NVDA-2026-09-01.txt"',
          },
        }),
    );
    const res = await app.fetch(request("/prism/NVDA/export"));
    expect(calls[0]?.url).toBe(`${ENGINE}/api/prism/NVDA/export?format=txt`);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="prism-NVDA-2026-09-01.txt"',
    );
  });

  test("an unsupported format is rejected locally", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => new Response("body"));
    const res = await app.fetch(request("/prism/NVDA/export?format=docx"));
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toMatchObject({ code: "prism_bad_request" });
    expect(calls).toHaveLength(0);
  });

  test("an export of an unbuilt packet is a 404, not a broken download", async () => {
    stubFetch([], () => Response.json({ error: "no packet" }, { status: 404 }));
    const res = await app.fetch(request("/prism/NVDA/export?format=pdf"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("/v1/ubermemo alias", () => {
  test("the working name resolves to the same handlers", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, (url) =>
      url === `${ENGINE}/api/prism/NVDA` ? Response.json(packet("NVDA")) : undefined,
    );
    const res = await app.fetch(request("/ubermemo/NVDA"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).ticker).toBe("NVDA");
    expect(calls[0]?.url).toBe(`${ENGINE}/api/prism/NVDA`);
  });

  test("the alias build is metered on the same meter", async () => {
    stubFetch([], () => Response.json(packet("NVDA")));
    const res = await app.fetch(request("/ubermemo", { ticker: "NVDA" }));
    expect(res.status).toBe(200);
    expect(await remainingQuota()).toBe(49);
  });
});

describe("research prompt Prism context", () => {
  test("buildResearchPrompt is byte-identical without a summary", () => {
    expect(buildResearchPrompt("Find the edge", "MXL")).toBe(
      "Focus ticker: $MXL. Write like a short financial news brief when you conclude — lede first, then evidence. Research-only; no trades; no broker orders.\n\nUser: Find the edge",
    );
    expect(buildResearchPrompt("Find the edge", "MXL", "   ")).toBe(
      buildResearchPrompt("Find the edge", "MXL"),
    );
  });

  test("a summary is injected before the user marker and capped", () => {
    const prompt = buildResearchPrompt("Find the edge", "NVDA", "NVDA · buy · conviction 0.62");
    expect(prompt).toContain("Prism packet context for $NVDA");
    expect(prompt).toContain("NVDA · buy · conviction 0.62");
    expect(prompt.indexOf("Prism packet context")).toBeLessThan(prompt.indexOf("\n\nUser: "));

    const huge = buildResearchPrompt("q", "NVDA", "x".repeat(20_000));
    expect(huge.length).toBeLessThan(7_000);
  });

  test("prismSummaryForPrompt swallows every engine failure", async () => {
    stubFetch([], () => Response.json({ error: "no packet" }, { status: 404 }));
    expect(await prismSummaryForPrompt("NVDA")).toBeUndefined();

    stubFetch([], () => {
      throw new Error("network down");
    });
    expect(await prismSummaryForPrompt("NVDA")).toBeUndefined();

    // An unusable symbol never opens a socket at all.
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json({ text: "x" }));
    expect(await prismSummaryForPrompt("../secrets")).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("prismSummaryForPrompt returns the projection text when the engine has one", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, (url) =>
      url === `${ENGINE}/api/prism/NVDA/summary`
        ? Response.json({ ticker: "NVDA", text: "NVDA · buy (normal), conviction 0.62" })
        : undefined,
    );
    expect(await prismSummaryForPrompt("nvda")).toBe("NVDA · buy (normal), conviction 0.62");
    expect(calls[0]?.url).toBe(`${ENGINE}/api/prism/NVDA/summary`);
  });
});

describe("prismSummaryForPrompt caching", () => {
  test("a hit is reused instead of re-fetched", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, (url) =>
      url === `${ENGINE}/api/prism/NVDA/summary`
        ? Response.json({ ticker: "NVDA", text: "NVDA · buy" })
        : undefined,
    );
    expect(await prismSummaryForPrompt("NVDA")).toBe("NVDA · buy");
    expect(await prismSummaryForPrompt("nvda")).toBe("NVDA · buy");
    expect(calls).toHaveLength(1);
  });

  test("a miss is remembered too — the common case must not pay per turn", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json({ error: "no packet" }, { status: 404 }));
    expect(await prismSummaryForPrompt("MXL")).toBeUndefined();
    expect(await prismSummaryForPrompt("MXL")).toBeUndefined();
    expect(await prismSummaryForPrompt("MXL")).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  test("the reset helper clears both halves", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json({ error: "no packet" }, { status: 404 }));
    expect(await prismSummaryForPrompt("MU")).toBeUndefined();
    __resetPrismSummaryCache();
    expect(await prismSummaryForPrompt("MU")).toBeUndefined();
    expect(calls).toHaveLength(2);
  });
});

describe("POST /v1/agent/chat Prism pre-load", () => {
  function consoleStub(calls: FetchCall[], summary: Response | undefined) {
    stubFetch(calls, (url) => {
      if (url === `${ENGINE}/api/prism/MXL/summary`) return summary;
      if (url.endsWith("/api/explore")) {
        return Response.json(
          {
            mode: "agent",
            conversation: {
              schema_version: "research_conversation_ref_v1",
              id: "prism_conv",
              conversation_id: "conv_prism_conv",
              status: "conclusive",
              deliverable: "ideas",
              href: "/explore?conversation_id=conv_prism_conv",
              stream_href: "/api/autoresearch/stream?id=prism_conv",
              pdf_url: null,
            },
          },
          { status: 202 },
        );
      }
      if (url.includes("/api/autoresearch")) {
        return Response.json({
          id: "prism_conv",
          status: "conclusive",
          phase: "complete",
          active: false,
          preview: { briefing: "Brief" },
          latest_result: { mode: "agent", briefing: "Brief" },
          messages: [{ id: "m1", role: "assistant", content: "Brief", created_at: "2026-09-01" }],
        });
      }
      return undefined;
    });
  }

  function explorePrompt(calls: FetchCall[]): string {
    const call = calls.find((item) => item.url.endsWith("/api/explore"));
    return String((call?.body as Record<string, unknown> | undefined)?.prompt ?? "");
  }

  test("injects the packet summary when the engine has one", async () => {
    const calls: FetchCall[] = [];
    consoleStub(calls, Response.json({ ticker: "MXL", text: "MXL · hold, conviction 0.31" }));

    const res = await app.fetch(
      request("/agent/chat", { message: "Find the edge", ticker: "MXL" }),
    );
    expect(res.status).toBe(200);
    expect(calls[0]?.url).toBe(`${ENGINE}/api/prism/MXL/summary`);
    expect(explorePrompt(calls)).toContain("MXL · hold, conviction 0.31");
  });

  test("a missing packet leaves the research turn and its prompt untouched", async () => {
    const calls: FetchCall[] = [];
    consoleStub(calls, Response.json({ error: "no packet" }, { status: 404 }));

    const res = await app.fetch(
      request("/agent/chat", { message: "Find the edge", ticker: "MXL" }),
    );
    expect(res.status).toBe(200);
    expect(explorePrompt(calls)).toBe(
      "Focus ticker: $MXL. Write like a short financial news brief when you conclude — lede first, then evidence. Research-only; no trades; no broker orders.\n\nUser: Find the edge",
    );
  });

  test("no ticker means no engine call at all", async () => {
    const calls: FetchCall[] = [];
    consoleStub(calls, undefined);

    const res = await app.fetch(request("/agent/chat", { message: "What is happening today?" }));
    expect(res.status).toBe(200);
    expect(calls.some((call) => call.url.includes("/api/prism"))).toBe(false);
  });
});
