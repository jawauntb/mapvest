import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  SituateBuildRequest,
  SituateChatRequest,
  SituateChatResponse,
  SituateOddsHorizon,
  SituatePacket,
  SituatePosture,
  SituateSummary,
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
import { buildResearchPrompt } from "../src/lib/research-agent.js";
import { __resetResearchConversationStore } from "../src/lib/research-conversation-store.js";
import {
  SITUATE_BUILD_TIMEOUT_MS,
  SITUATE_SUMMARY_TIMEOUT_MS,
  SITUATE_UPSTREAM_URL,
  __resetSituateSummaryCache,
  normalizeSituateChatResponse,
  normalizeSituateExportFormat,
  normalizeSituateTicker,
  renderSituateSummary,
  situateSummaryForPrompt,
} from "../src/lib/situate.js";
import { __resetStore } from "../src/lib/store.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";
import { SITUATE_CHAT_LIMIT, __resetSituateChatLimit } from "../src/routes/situate.js";

// `lib/underlying.ts` freezes the origin at module load, and ES imports are
// hoisted above these assignments, so the suite targets whatever origin the
// process actually resolved rather than trying to set UNDERLYING_URL here.
const ENGINE = SITUATE_UPSTREAM_URL;
const DEVICE = "device-situate-test";

type FetchCall = { url: string; method: string; body?: unknown };

const originalFetch = globalThis.fetch;

function urlOf(input: URL | Request | string): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

/** Installs a fetch stub and records every upstream call (mirrors prism.test.ts). */
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

/** A full Situate packet, shaped like the engine's `build_situate_packet`. */
function packet(ticker: string): Record<string, unknown> {
  return {
    ticker,
    as_of: "2026-09-01",
    generated_at: "2026-09-01T12:00:00.000Z",
    engine: "Situate",
    engine_version: "1.0.0",
    profile: {
      name: "NVIDIA Corp",
      sector: "Technology",
      industry: "Semiconductors",
      related_etfs: ["SOXX", "XLK"],
    },
    exposure: {
      basket: ["SPY", "SOXX", "IWM-SPY", "DXY", "WTI"],
      betas: { SPY: 1.31, SOXX: 0.72 },
      se: { SPY: 0.08, SOXX: 0.11 },
      r2: 0.68,
      idiosyncratic_share: 0.32,
      residual_vol_annual: 0.29,
      change_12m: { SPY: 0.14 },
      method: "ewma_ridge",
    },
    state: {
      spy: { vol_state: "low", trend_state: "up", cell: "low_up", realized_vol_21d: 0.11 },
      ticker: { vol_state: "high", trend_state: "up", cell: "high_up", realized_vol_21d: 0.34 },
      hmm: { probs: { bull: 0.62, neutral: 0.28, bear: 0.1 }, label: "bull" },
      context: { vix_pct: 0.41, hy_oas_pct: 0.22, curve_10y_2y: 0.35 },
    },
    base_rates: {
      by_horizon: {
        "3": {
          uncond: { q05: -0.18, q25: -0.05, q50: 0.03, q75: 0.11, q95: 0.27, hit: 0.58, n_eff: 84 },
          cond: { q50: 0.05, cell: "high_up", n_eff: 21 },
          shrunk: { q50: 0.036, w: 0.47 },
        },
      },
    },
    implied: {
      snapshot_ts: "2026-09-01T20:00:00.000Z",
      by_horizon: {
        "3": {
          expiry: "2026-12-19",
          iv_atm: 0.42,
          skew_25d: -0.03,
          quantiles: { q05: -0.22, q25: -0.07, q50: 0.01, q75: 0.09, q95: 0.28 },
          p_up10: 0.38,
          p_dn10: 0.31,
          width_ratio_vs_hist: 1.18,
        },
      },
    },
    fundamentals: {
      momentum: { ret_12_1: 0.44, ret_1m_reversal: -0.03 },
      quality: { gp_to_assets: 0.51, accruals: 0.02, net_debt_ebitda: -0.4, interest_cov: 58.2 },
      value_z: { ev_sales: 1.4, ev_ebitda: 0.9, pe_fwd: 1.1, fcf_yield: -0.8, basis: "own_5y" },
      trajectory: [
        {
          period_end: "2026-04-30",
          filing_date: "2026-05-28",
          rev_growth: 0.69,
          gross_margin: 0.75,
          op_margin: 0.62,
        },
      ],
      trajectory_flags: { rev_accel: true, margin_accel: false },
      revisions: null,
      pead: null,
      revisions_error: "no consensus-estimate provider",
      pead_error: "no consensus-estimate provider",
    },
    text: {
      filing_changes: [
        {
          section: "Item 1A Risk Factors",
          change_score: 0.31,
          new_risks: [{ text: "New export-control exposure", quote: "additional licensing…" }],
          material_change_score: 3,
        },
      ],
      events: [
        {
          date: "2026-08-28",
          type: "earnings",
          sentiment: "positive",
          headline: "Datacenter revenue beats",
          url: "https://example.test/nvda",
        },
      ],
      exposure_flags: ["china_revenue"],
    },
    levels: {
      poc: 138.5,
      vah: 151.2,
      val: 122.9,
      ma20: 141.0,
      ma50: 133.4,
      ma200: 118.7,
      cheap_zone: { price_lo: 120.0, price_hi: 128.0, horizon: "3" },
      rich_zone: { price_lo: 158.0, price_hi: 170.0, horizon: "3" },
    },
    stack: {
      published: false,
      reason: "insufficient breadth in curated peer universe",
      configs_tried: 12,
    },
    odds: {
      "3": {
        source: "base_rates+implied",
        quantiles: { q05: -0.2, q25: -0.06, q50: 0.03, q75: 0.1, q95: 0.27 },
        p_up: 0.56,
        base_rate_q50: 0.03,
        shrink_w: 0.47,
      },
    },
    scenarios: {
      bull: { state: "low_up", horizons: { "3": { quantile: 0.1, drivers: ["SPY", "SOXX"] } } },
      neutral: { state: "high_up", horizons: {} },
      bear: { state: "high_down", horizons: {} },
    },
    memo: {
      posture: {
        stance: "odds_favorable",
        horizon: "3m",
        conviction: 0.58,
        one_line:
          "The data suggests odds favor the upside over three months, but the options price a wide band.",
      },
      text: "# Situate\n\nThe data suggests. Not investment advice.",
      falsifiers: [
        "Realized vol breaks above 45%",
        "12-1 momentum turns negative",
        "Filing risk score jumps",
      ],
      key_determinants: [
        { name: "exposure", explanation: "High SOXX beta drives the residual.", direction: "up" },
      ],
      whats_priced_in: ["Implied IQR is 1.18x the historical conditional band"],
      citations: [{ id: "c1", claim: "SPY beta 1.31", module: "exposure", version: "1.0.0" }],
      zones: { cheap: { price_lo: 120, price_hi: 128 }, rich: { price_lo: 158, price_hi: 170 } },
      model: "claude-opus-4-8",
      generated_at: "2026-09-01T12:00:00.000Z",
    },
    sources: [{ provider: "massive", fetched_at: "2026-09-01T11:59:00.000Z", confidence: "high" }],
    meta: {
      errors: [{ source: "stack", error: "insufficient breadth" }],
      unavailable: [{ source: "estimates", error: "no consensus-estimate provider" }],
      source_status: { massive: "ok", fred: "ok", sec: "ok" },
      timings_ms: { total: 88123 },
      versions: { exposure: "1.0.0", base_rates: "1.0.0", implied: "1.0.0" },
      cache: { panel: "hit", factors: "miss" },
    },
  };
}

/** The bounded projection `GET /api/situate/{ticker}/summary` returns. */
function engineSummary(): Record<string, unknown> {
  return {
    ticker: "SPY",
    as_of: "2026-09-01",
    generated_at: "2026-09-01T23:22:33.255432+00:00",
    engine_version: "1.0.0",
    name: "State Street SPDR S&P 500 ETF Trust",
    sector: null,
    industry: null,
    posture: {
      stance: "balanced",
      horizon: "6m",
      conviction: 0.34,
      one_line: "The data suggests the odds are balanced over six months.",
    },
    one_line: "The data suggests the odds are balanced over six months.",
    memo_excerpt: "Situate read SPY as range-bound.",
    unavailable_sections: ["stack"],
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
  __resetSituateSummaryCache();
  __resetSituateChatLimit();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("situate schemas", () => {
  test("SituatePacket parses a full packet and keeps unknown keys and *_error siblings", () => {
    const parsed = SituatePacket.parse(packet("NVDA"));
    expect(parsed.ticker).toBe("NVDA");
    expect(parsed.memo?.posture.stance).toBe("odds_favorable");
    expect(parsed.odds?.["3"]?.source).toBe("base_rates+implied");
    expect(parsed.meta.errors[0]?.source).toBe("stack");
    expect((parsed.fundamentals as Record<string, unknown>).revisions_error).toBe(
      "no consensus-estimate provider",
    );
  });

  test("SituatePacket accepts null sections but not a missing one", () => {
    const nulled = { ...packet("MU"), exposure: null, implied: null, memo: null, odds: null };
    expect(SituatePacket.safeParse(nulled).success).toBe(true);

    const { exposure: _dropped, ...missing } = packet("MU");
    expect(SituatePacket.safeParse(missing).success).toBe(false);
  });

  test("analytical sections are loose — a new engine field survives parsing", () => {
    const grown = packet("NVDA") as Record<string, unknown>;
    grown.exposure = { r2: 0.7, factor: { loadings: { MKT: 1.1, MOM: 0.3 } } };
    const parsed = SituatePacket.parse(grown);
    expect((parsed.exposure as Record<string, unknown>)?.factor).toEqual({
      loadings: { MKT: 1.1, MOM: 0.3 },
    });
  });

  test("the posture grammar is strict and never buy/sell", () => {
    // A buy/sell stance is not in the grammar.
    expect(
      SituatePosture.safeParse({ stance: "buy", horizon: "3m", conviction: 0.5, one_line: "x" })
        .success,
    ).toBe(false);
    // Conviction is [0,1].
    expect(
      SituatePosture.safeParse({
        stance: "balanced",
        horizon: "3m",
        conviction: 1.4,
        one_line: "x",
      }).success,
    ).toBe(false);
    // No extra keys.
    expect(
      SituatePosture.safeParse({
        stance: "balanced",
        horizon: "3m",
        conviction: 0.5,
        one_line: "x",
        recommendation: "buy",
      }).success,
    ).toBe(false);
    expect(
      SituatePosture.safeParse({
        stance: "odds_unfavorable",
        horizon: "12m",
        conviction: 0.2,
        one_line: "x",
      }).success,
    ).toBe(true);
  });

  test("an odds horizon entry is strict about its contract shape", () => {
    expect(
      SituateOddsHorizon.safeParse({
        source: "stack",
        quantiles: { q50: 0.03 },
        p_up: 0.55,
        base_rate_q50: 0.02,
        shrink_w: 0.4,
      }).success,
    ).toBe(true);
    // An unknown source is rejected.
    expect(
      SituateOddsHorizon.safeParse({ source: "vibes", quantiles: { q50: 0.03 } }).success,
    ).toBe(false);
    // An extra top-level key is rejected (it is a rendered contract).
    expect(
      SituateOddsHorizon.safeParse({
        source: "stack",
        quantiles: { q50: 0.03 },
        recommendation: "buy",
      }).success,
    ).toBe(false);
  });

  test("meta pins its documented keys and passes the rest through", () => {
    const real = packet("SPY") as Record<string, unknown>;
    real.meta = {
      errors: [],
      unavailable: [{ source: "estimates", error: "no provider" }],
      source_status: { massive: "available" },
      timings_ms: { total: 90000 },
      versions: { exposure: "1.0.0" },
      cache: { panel: "miss", hits: 12, misses: 3 },
      stored: { ticker: "SPY", local_path: "/tmp/s.json", supabase_id: null },
      notes: ["panel reused from cache"],
    };
    const parsed = SituatePacket.safeParse(real);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.meta.versions.exposure).toBe("1.0.0");
    expect(parsed.data.meta.cache.hits).toBe(12);
  });

  test("SituateSummary parses the engine's projection, which has no `text` key", () => {
    const parsed = SituateSummary.safeParse(engineSummary());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.text).toBeUndefined();
    expect(parsed.data.memo_excerpt).toBe("Situate read SPY as range-bound.");
    expect(parsed.data.posture?.stance).toBe("balanced");
  });

  test("request schemas bound their inputs", () => {
    expect(SituateBuildRequest.safeParse({ ticker: "NVDA", force: true }).success).toBe(true);
    expect(SituateBuildRequest.safeParse({ ticker: "NVDA", asOf: "2025-06-30" }).success).toBe(
      true,
    );
    expect(SituateBuildRequest.safeParse({}).success).toBe(false);
    expect(SituateChatRequest.safeParse({ ticker: "NVDA", message: "" }).success).toBe(false);
    expect(
      SituateChatRequest.safeParse({
        ticker: "NVDA",
        message: "why favorable?",
        history: [{ role: "user", content: "hi" }],
      }).success,
    ).toBe(true);
  });
});

describe("situate upstream client helpers", () => {
  test("a cold build gets the full 180s budget", () => {
    expect(SITUATE_BUILD_TIMEOUT_MS).toBe(180_000);
    expect(SITUATE_SUMMARY_TIMEOUT_MS).toBe(3_000);
  });

  test("normalizeSituateTicker uppercases, accepts crypto/FX pairs, and rejects junk", () => {
    expect(normalizeSituateTicker(" nvda ")).toBe("NVDA");
    expect(normalizeSituateTicker("X:BTCUSD")).toBe("X:BTCUSD");
    expect(normalizeSituateTicker("BRK.B")).toBe("BRK.B");
    expect(normalizeSituateTicker("../../etc/passwd")).toBeNull();
    expect(normalizeSituateTicker("NVDA?force=1")).toBeNull();
    expect(normalizeSituateTicker("")).toBeNull();
    expect(normalizeSituateTicker(undefined)).toBeNull();
  });

  test("normalizeSituateExportFormat defaults to txt and rejects anything else", () => {
    expect(normalizeSituateExportFormat(undefined)).toBe("txt");
    expect(normalizeSituateExportFormat("PDF")).toBe("pdf");
    expect(normalizeSituateExportFormat("docx")).toBeNull();
  });

  test("normalizeSituateChatResponse maps snake_case onto the camelCase contract", () => {
    const normalized = normalizeSituateChatResponse(
      {
        reply: "Because the shrunk base rate is positive.",
        conversation_id: "chat_1",
        generated_at: "2026-09-01T12:05:00.000Z",
        model: "claude-opus-4-8",
        citations: [{ id: "base_rates.3.shrunk" }],
        extra_engine_field: 7,
      },
      "NVDA",
    );
    expect(normalized).toMatchObject({
      ticker: "NVDA",
      reply: "Because the shrunk base rate is positive.",
      conversationId: "chat_1",
      generatedAt: "2026-09-01T12:05:00.000Z",
      model: "claude-opus-4-8",
    });
    expect(normalized.citations[0]?.id).toBe("base_rates.3.shrunk");
    expect((normalized as Record<string, unknown>).extra_engine_field).toBe(7);
    expect((normalized as Record<string, unknown>).conversation_id).toBeUndefined();
  });

  test("renderSituateSummary prefers text, then renders the projection as lines", () => {
    expect(renderSituateSummary({ text: " packet digest " })).toBe("packet digest");
    expect(renderSituateSummary("raw digest")).toBe("raw digest");
    const rendered = renderSituateSummary(engineSummary()) ?? "";
    expect(rendered.startsWith("{")).toBe(false);
    expect(rendered).toContain("Situate packet: SPY as of 2026-09-01");
    expect(rendered).toContain("Posture: balanced at 6m, conviction 34.0%");
    expect(rendered).toContain("Memo excerpt: Situate read SPY as range-bound.");
    expect(rendered).toContain("Sections unavailable: stack");
  });
});

describe("POST /v1/situate", () => {
  test("forwards the build to the engine, returns the packet verbatim, and meters it", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, (url) =>
      url === `${ENGINE}/api/situate` ? Response.json(packet("NVDA")) : undefined,
    );

    expect(await remainingQuota()).toBe(50);
    const res = await app.fetch(
      request("/situate", { ticker: "nvda", force: true, includeMemo: false }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(SituatePacket.safeParse(body).success).toBe(true);
    expect(body.ticker).toBe("NVDA");

    const build = calls.find((call) => call.url === `${ENGINE}/api/situate`);
    expect(build?.method).toBe("POST");
    expect(build?.body).toEqual({ ticker: "NVDA", force: true, include_memo: false });
    expect(await remainingQuota()).toBe(49);
  });

  test("forwards a pinned as_of for a walk-forward build", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json(packet("MU")));
    const res = await app.fetch(request("/situate", { ticker: "MU", asOf: "2025-06-30" }));
    expect(res.status).toBe(200);
    expect(calls[0]?.body).toEqual({ ticker: "MU", as_of: "2025-06-30" });
  });

  test("accepts the engine's include_memo / as_of spellings from the caller too", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json(packet("MU")));
    const res = await app.fetch(
      request("/situate", { ticker: "MU", include_memo: false, as_of: "2025-01-31" }),
    );
    expect(res.status).toBe(200);
    expect(calls[0]?.body).toEqual({ ticker: "MU", include_memo: false, as_of: "2025-01-31" });
  });

  test("rejects a missing or unusable ticker before touching the engine", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json(packet("NVDA")));

    const missing = await app.fetch(request("/situate", {}));
    expect(missing.status).toBe(400);
    expect((await missing.json()) as unknown).toMatchObject({ code: "situate_bad_request" });

    const bad = await app.fetch(request("/situate", { ticker: "not a ticker" }));
    expect(bad.status).toBe(400);

    expect(calls).toHaveLength(0);
    expect(await remainingQuota()).toBe(50);
  });

  test("requires an identity for the metered build", async () => {
    stubFetch([], () => Response.json(packet("NVDA")));
    const res = await app.fetch(
      new Request("http://localhost/v1/situate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: "NVDA" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("a repeat build of the same ticker on the same day meters once", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => {
      const body = packet("NVDA") as Record<string, unknown>;
      (body.meta as Record<string, unknown>).cache = { packet: "hit" };
      return Response.json(body);
    });

    expect((await app.fetch(request("/situate", { ticker: "NVDA" }))).status).toBe(200);
    expect(await remainingQuota()).toBe(49);

    expect((await app.fetch(request("/situate", { ticker: "nvda" }))).status).toBe(200);
    expect((await app.fetch(request("/situate", { ticker: "NVDA" }))).status).toBe(200);
    expect(await remainingQuota()).toBe(49);

    // A different ticker is a different build and is charged for.
    expect((await app.fetch(request("/situate", { ticker: "MU" }))).status).toBe(200);
    expect(await remainingQuota()).toBe(48);
  });

  test("a forced rebuild is charged every time", async () => {
    stubFetch([], () => Response.json(packet("NVDA")));
    await app.fetch(request("/situate", { ticker: "NVDA" }));
    expect(await remainingQuota()).toBe(49);
    await app.fetch(request("/situate", { ticker: "NVDA", force: true }));
    expect(await remainingQuota()).toBe(48);
    await app.fetch(request("/situate", { ticker: "NVDA", force: true }));
    expect(await remainingQuota()).toBe(47);
  });

  test("an engine failure is a 502 that does not burn quota", async () => {
    stubFetch([], () => Response.json({ error: "engine exploded" }, { status: 500 }));
    const res = await app.fetch(request("/situate", { ticker: "NVDA" }));
    expect(res.status).toBe(502);
    expect((await res.json()) as unknown).toMatchObject({
      code: "situate_upstream_failed",
      upstreamStatus: 500,
    });
    expect(await remainingQuota()).toBe(50);
  });

  test("engine back-pressure is forwarded with its Retry-After", async () => {
    stubFetch([], () =>
      Response.json(
        { error: "situate build concurrency reached" },
        { status: 429, headers: { "Retry-After": "30" } },
      ),
    );
    const res = await app.fetch(request("/situate", { ticker: "NVDA" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect((await res.json()) as unknown).toMatchObject({ code: "situate_busy" });
    expect(await remainingQuota()).toBe(50);
  });

  test("an unreachable engine is a 502, not a crash", async () => {
    stubFetch([], () => {
      throw new Error("connect ECONNREFUSED");
    });
    const res = await app.fetch(request("/situate", { ticker: "NVDA" }));
    expect(res.status).toBe(502);
    expect((await res.json()) as unknown).toMatchObject({ code: "situate_upstream_failed" });
  });
});

describe("GET /v1/situate/:ticker", () => {
  test("returns the latest stored packet", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, (url) =>
      url === `${ENGINE}/api/situate/NVDA` ? Response.json(packet("NVDA")) : undefined,
    );
    const res = await app.fetch(request("/situate/nvda"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).ticker).toBe("NVDA");
    expect(calls[0]?.method).toBe("GET");
  });

  test("an unbuilt ticker is a 404 that tells the client how to build one", async () => {
    stubFetch([], () => Response.json({ error: "no packet" }, { status: 404 }));
    const res = await app.fetch(request("/situate/NVDA"));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("situate_packet_not_found");
  });

  test("reading a packet is free", async () => {
    stubFetch([], () => Response.json(packet("NVDA")));
    await app.fetch(request("/situate/NVDA"));
    expect(await remainingQuota()).toBe(50);
  });

  test("GET /v1/situate describes the surface without calling the engine", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json(packet("NVDA")));
    const res = await app.fetch(request("/situate"));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({ name: "Situate", alias: "research" });
    expect(calls).toHaveLength(0);
  });
});

describe("GET /v1/situate/:ticker/summary", () => {
  test("proxies the bounded agent projection", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, (url) =>
      url === `${ENGINE}/api/situate/NVDA/summary`
        ? Response.json({ ticker: "NVDA", text: "NVDA · odds favorable (3m)" })
        : undefined,
    );
    const res = await app.fetch(request("/situate/NVDA/summary"));
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toMatchObject({ ticker: "NVDA" });
  });

  test("an invalid ticker never reaches the engine", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json({}));
    const res = await app.fetch(request("/situate/lower%20case%20junk/summary"));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("POST /v1/situate/chat", () => {
  test("normalizes the engine turn and is not routed to GET /:ticker", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, (url) =>
      url === `${ENGINE}/api/situate/NVDA/chat`
        ? Response.json({
            reply: "The shrunk base rate median is +3.6% at 3 months.",
            conversation_id: "chat_9",
            generated_at: "2026-09-01T12:05:00.000Z",
            citations: [{ id: "base_rates.3.shrunk", claim: "q50 +3.6%" }],
          })
        : undefined,
    );

    const res = await app.fetch(
      request("/situate/chat", {
        ticker: "nvda",
        message: "What are the 3-month odds?",
        conversationId: "chat_9",
        history: [{ role: "user", content: "hi" }],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ticker: "NVDA", conversationId: "chat_9" });
    expect(body.reply).toContain("shrunk base rate");

    // The engine reads the ticker from the URL path, not the body.
    expect(calls[0]?.url).toBe(`${ENGINE}/api/situate/NVDA/chat`);
    expect(calls[0]?.body).toEqual({
      ticker: "NVDA",
      message: "What are the 3-month odds?",
      conversation_id: "chat_9",
      history: [{ role: "user", content: "hi" }],
    });
    // A chat turn is not a generation.
    expect(await remainingQuota()).toBe(50);
  });

  test("rejects an empty message", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json({ reply: "x" }));
    const res = await app.fetch(request("/situate/chat", { ticker: "NVDA", message: "" }));
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test("requires an identity — the upstream turn has to be attributable", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json({ reply: "x" }));
    const res = await app.fetch(
      new Request("http://localhost/v1/situate/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: "NVDA", message: "why?" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test("caps chat turns per identity", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json({ reply: "ok" }));

    for (let i = 0; i < SITUATE_CHAT_LIMIT; i++) {
      const ok = await app.fetch(request("/situate/chat", { ticker: "NVDA", message: `q${i}` }));
      expect(ok.status).toBe(200);
    }
    expect(calls).toHaveLength(SITUATE_CHAT_LIMIT);

    const refused = await app.fetch(request("/situate/chat", { ticker: "NVDA", message: "more" }));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBeTruthy();
    expect((await refused.json()) as unknown).toMatchObject({ code: "situate_chat_rate_limited" });
    expect(calls).toHaveLength(SITUATE_CHAT_LIMIT);
  });

  test("chatting about an unbuilt ticker surfaces the engine 404", async () => {
    stubFetch([], () => Response.json({ error: "no packet for NVDA" }, { status: 404 }));
    const res = await app.fetch(request("/situate/chat", { ticker: "NVDA", message: "why?" }));
    expect(res.status).toBe(404);
    expect((await res.json()) as unknown).toMatchObject({ code: "situate_packet_not_found" });
  });
});

describe("GET /v1/situate/:ticker/export", () => {
  test("streams text with a download filename", async () => {
    const calls: FetchCall[] = [];
    // Mirror the engine: it serves md|json|pdf and 400s anything else (the
    // client-facing `txt` must be translated to `md` before it reaches here, or
    // this mock would reject it — catching path/format drift).
    stubFetch(calls, (url) => {
      if (!url.startsWith(`${ENGINE}/api/situate/NVDA/export`)) return undefined;
      const format = new URL(url).searchParams.get("format");
      if (format && ["md", "json", "pdf"].includes(format)) {
        return new Response("SITUATE PACKET — NVDA\n", {
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        });
      }
      return Response.json({ error: `unsupported format ${format}` }, { status: 400 });
    });

    const res = await app.fetch(request("/situate/NVDA/export?format=txt"));
    expect(res.status).toBe(200);
    // The client asked for txt; the upstream call carries the engine's md.
    expect(calls[0]?.url).toBe(`${ENGINE}/api/situate/NVDA/export?format=md`);
    // Toward the client the txt content-type/filename are preserved (the engine
    // emitted text/markdown, which the route passes through verbatim here).
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="situate-NVDA.txt"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).toContain("SITUATE PACKET");
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
    const res = await app.fetch(request("/situate/NVDA/export?format=pdf"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="situate-NVDA.pdf"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  test("an unsupported format is rejected locally", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => new Response("body"));
    const res = await app.fetch(request("/situate/NVDA/export?format=docx"));
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toMatchObject({ code: "situate_bad_request" });
    expect(calls).toHaveLength(0);
  });
});

describe("/v1/research alias", () => {
  test("the neutral name resolves to the same handlers", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, (url) =>
      url === `${ENGINE}/api/situate/NVDA` ? Response.json(packet("NVDA")) : undefined,
    );
    const res = await app.fetch(request("/research/NVDA"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).ticker).toBe("NVDA");
    expect(calls[0]?.url).toBe(`${ENGINE}/api/situate/NVDA`);
  });

  test("the alias build is metered on the same meter", async () => {
    stubFetch([], () => Response.json(packet("NVDA")));
    const res = await app.fetch(request("/research", { ticker: "NVDA" }));
    expect(res.status).toBe(200);
    expect(await remainingQuota()).toBe(49);
  });
});

describe("research prompt Situate context", () => {
  test("buildResearchPrompt is byte-identical without any summary", () => {
    expect(buildResearchPrompt("Find the edge", "MXL")).toBe(
      "Focus ticker: $MXL. Write like a short financial news brief when you conclude — lede first, then evidence. Research-only; no trades; no broker orders.\n\nUser: Find the edge",
    );
  });

  test("the Prism block stays byte-identical when only a Prism summary is present", () => {
    const prompt = buildResearchPrompt("q", "NVDA", "NVDA · buy · conviction 0.62");
    expect(prompt).toContain("Prism packet context for $NVDA");
    expect(prompt).not.toContain("Situate packet context");
  });

  test("a Situate summary is preferred and injected before the user marker", () => {
    const prompt = buildResearchPrompt(
      "Find the edge",
      "NVDA",
      "prism digest",
      "NVDA · odds favorable · 3m",
    );
    expect(prompt).toContain("Situate packet context for $NVDA");
    expect(prompt).toContain("NVDA · odds favorable · 3m");
    expect(prompt).not.toContain("Prism packet context");
    expect(prompt.indexOf("Situate packet context")).toBeLessThan(prompt.indexOf("\n\nUser: "));
  });

  test("situateSummaryForPrompt swallows every engine failure", async () => {
    stubFetch([], () => Response.json({ error: "no packet" }, { status: 404 }));
    expect(await situateSummaryForPrompt("NVDA")).toBeUndefined();

    stubFetch([], () => {
      throw new Error("network down");
    });
    expect(await situateSummaryForPrompt("NVDA")).toBeUndefined();

    const calls: FetchCall[] = [];
    stubFetch(calls, () => Response.json({ text: "x" }));
    expect(await situateSummaryForPrompt("../secrets")).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("situateSummaryForPrompt caches a hit and a miss", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, (url) =>
      url === `${ENGINE}/api/situate/NVDA/summary`
        ? Response.json({ ticker: "NVDA", text: "NVDA · odds favorable" })
        : undefined,
    );
    expect(await situateSummaryForPrompt("NVDA")).toBe("NVDA · odds favorable");
    expect(await situateSummaryForPrompt("nvda")).toBe("NVDA · odds favorable");
    expect(calls).toHaveLength(1);
  });
});

describe("POST /v1/agent/chat Situate pre-load", () => {
  function consoleStub(calls: FetchCall[], summary: Response | undefined) {
    stubFetch(calls, (url) => {
      if (url === `${ENGINE}/api/situate/MXL/summary`) return summary;
      // No Prism packet for MXL in these tests.
      if (url === `${ENGINE}/api/prism/MXL/summary`)
        return Response.json({ error: "no packet" }, { status: 404 });
      if (url.endsWith("/api/explore")) {
        return Response.json(
          {
            mode: "agent",
            conversation: {
              schema_version: "research_conversation_ref_v1",
              id: "situate_conv",
              conversation_id: "conv_situate_conv",
              status: "conclusive",
              deliverable: "ideas",
              href: "/explore?conversation_id=conv_situate_conv",
              stream_href: "/api/autoresearch/stream?id=situate_conv",
              pdf_url: null,
            },
          },
          { status: 202 },
        );
      }
      if (url.includes("/api/autoresearch")) {
        return Response.json({
          id: "situate_conv",
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

  test("injects the Situate summary when the engine has one", async () => {
    const calls: FetchCall[] = [];
    consoleStub(calls, Response.json({ ticker: "MXL", text: "MXL · balanced, conviction 0.31" }));

    const res = await app.fetch(
      request("/agent/chat", { message: "Find the edge", ticker: "MXL" }),
    );
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.url === `${ENGINE}/api/situate/MXL/summary`)).toBe(true);
    expect(explorePrompt(calls)).toContain("MXL · balanced, conviction 0.31");
    expect(explorePrompt(calls)).toContain("Situate packet context");
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
    expect(calls.some((call) => call.url.includes("/api/situate"))).toBe(false);
  });
});
