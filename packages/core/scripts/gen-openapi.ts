#!/usr/bin/env bun
/**
 * Generate `openapi.yaml` at the repo root from the zod schemas in
 * `packages/core/src/schemas`.
 *
 * Every API request/response shape lives in `packages/core` as a zod schema
 * (see AGENTS.md §6, "Data source contract"). This script is the single
 * source that turns those schemas into an OpenAPI 3.1 document. Downstream
 * artifacts — the Postman collection, generated SDKs, and any future codegen —
 * consume `openapi.yaml`, never the zod source directly.
 *
 * Run:
 *   bun run openapi
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { stringify as yamlStringify } from "yaml";
import { z } from "zod";

import * as raw from "../src/schemas/index.js";

// Attach the `.openapi()` method to every zod schema in the process.
extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

/**
 * Register a component schema and return the ref-carrying copy that will emit
 * `$ref: '#/components/schemas/<name>'` when referenced from a route.
 */
function component<T extends z.ZodTypeAny>(name: string, schema: T): T {
  return registry.register(name, schema);
}

// -------- component schemas (named, reused via $ref) --------

const S = {
  Confidence: component("Confidence", raw.Confidence),
  Source: component("Source", raw.Source),
  LatLng: component("LatLng", raw.LatLng),
  Ticker: component("Ticker", raw.Ticker),
  Brand: component("Brand", raw.Brand),
  EtfExposure: component("EtfExposure", raw.EtfExposure),
  Comparable: component("Comparable", raw.Comparable),
  Investable: component("Investable", raw.Investable),
  PhotoIdentification: component("PhotoIdentification", raw.PhotoIdentification),
  IdentifyRequest: component("IdentifyRequest", raw.IdentifyRequest),
  IdentifyResponse: component("IdentifyResponse", raw.IdentifyResponse),
  Find: component("Find", raw.Find),
  FindsResponse: component("FindsResponse", raw.FindsResponse),
  NearbyRequest: component("NearbyRequest", raw.NearbyRequest),
  NearbyItem: component("NearbyItem", raw.NearbyItem),
  NearbyResponse: component("NearbyResponse", raw.NearbyResponse),
  WidgetNearbyItem: component("WidgetNearbyItem", raw.WidgetNearbyItem),
  WidgetNearbyResponse: component("WidgetNearbyResponse", raw.WidgetNearbyResponse),
  ResolveComparableRequest: component("ResolveComparableRequest", raw.ResolveComparableRequest),
  ResolveComparableResponse: component("ResolveComparableResponse", raw.ResolveComparableResponse),
  ChartResponse: component("ChartResponse", raw.ChartResponse),
  QuoteHistoryPoint: component("QuoteHistoryPoint", raw.QuoteHistoryPoint),
  QuoteHistoryResponse: component("QuoteHistoryResponse", raw.QuoteHistoryResponse),
  AggregatePoint: component("AggregatePoint", raw.AggregatePoint),
  AggregatesResponse: component("AggregatesResponse", raw.AggregatesResponse),
  OptionContract: component("OptionContract", raw.OptionContract),
  OptionSnapshot: component("OptionSnapshot", raw.OptionSnapshot),
  OptionsResponse: component("OptionsResponse", raw.OptionsResponse),
  OptionContractsResponse: component("OptionContractsResponse", raw.OptionContractsResponse),
  FinancialRatiosRequest: component("FinancialRatiosRequest", raw.FinancialRatiosRequest),
  FinancialRatio: component("FinancialRatio", raw.FinancialRatio),
  FinancialRatiosResponse: component("FinancialRatiosResponse", raw.FinancialRatiosResponse),
  OptionSummaryRequest: component("OptionSummaryRequest", raw.OptionSummaryRequest),
  OptionSummary: component("OptionSummary", raw.OptionSummary),
  OptionSummaryResponse: component("OptionSummaryResponse", raw.OptionSummaryResponse),
  OptionBarsRequest: component("OptionBarsRequest", raw.OptionBarsRequest),
  OptionBarsResponse: component("OptionBarsResponse", raw.OptionBarsResponse),
  CorporateEvent: component("CorporateEvent", raw.CorporateEvent),
  MarketEventsResponse: component("MarketEventsResponse", raw.MarketEventsResponse),
  MarketDataCapabilities: component("MarketDataCapabilities", raw.MarketDataCapabilities),
  AnalysisSnapshot: component("AnalysisSnapshot", raw.AnalysisSnapshot),
  CockpitResponse: component("CockpitResponse", raw.CockpitResponse),
  AlertsResponse: component("AlertsResponse", raw.AlertsResponse),
  AgentChatRequest: component("AgentChatRequest", raw.AgentChatRequest),
  AgentChatResponse: component("AgentChatResponse", raw.AgentChatResponse),
  AgentThreadSummary: component("AgentThreadSummary", raw.AgentThreadSummary),
  AgentConversationStatus: component("AgentConversationStatus", raw.AgentConversationStatus),
  ResearchArticle: component("ResearchArticle", raw.ResearchArticle),
  User: component("User", raw.User),
  Session: component("Session", raw.Session),
  Plan: component("Plan", raw.Plan),
  EntitlementState: component("EntitlementState", raw.EntitlementState),
  QuotaExceeded: component("QuotaExceeded", raw.QuotaExceeded),
  BillingPlatform: component("BillingPlatform", raw.BillingPlatform),
  BillingChannel: component("BillingChannel", raw.BillingChannel),
  BillingCheckoutRequest: component("BillingCheckoutRequest", raw.BillingCheckoutRequest),
  BillingCheckoutResponse: component("BillingCheckoutResponse", raw.BillingCheckoutResponse),
  BillingPortalResponse: component("BillingPortalResponse", raw.BillingPortalResponse),
  BillingAppleRequest: component("BillingAppleRequest", raw.BillingAppleRequest),
  UserProgress: component("UserProgress", raw.UserProgress),
  ProgressResponse: component("ProgressResponse", raw.ProgressResponse),
  UniverseSummary: component("UniverseSummary", raw.UniverseSummary),
  DexRarity: component("DexRarity", raw.DexRarity),
  DexRarityCounts: component("DexRarityCounts", raw.DexRarityCounts),
  DexSector: component("DexSector", raw.DexSector),
  DexResponse: component("DexResponse", raw.DexResponse),
  CompanyEdgeType: component("CompanyEdgeType", raw.CompanyEdgeType),
  CompanyEdge: component("CompanyEdge", raw.CompanyEdge),
  CompanyGraphResponse: component("CompanyGraphResponse", raw.CompanyGraphResponse),
  QuestKind: component("QuestKind", raw.QuestKind),
  Quest: component("Quest", raw.Quest),
  QuestsResponse: component("QuestsResponse", raw.QuestsResponse),
  TerritoryResponse: component("TerritoryResponse", raw.TerritoryResponse),
  ActiveEvent: component("ActiveEvent", raw.ActiveEvent),
  EventsResponse: component("EventsResponse", raw.EventsResponse),
  Rivalry: component("Rivalry", raw.Rivalry),
  RivalriesResponse: component("RivalriesResponse", raw.RivalriesResponse),
  CreateRivalryRequest: component("CreateRivalryRequest", raw.CreateRivalryRequest),
  DemandPulseBuyer: component("DemandPulseBuyer", raw.DemandPulseBuyer),
  DemandPulse: component("DemandPulse", raw.DemandPulse),
  EnvironmentSeries: component("EnvironmentSeries", raw.EnvironmentSeries),
  EnvironmentBrief: component("EnvironmentBrief", raw.EnvironmentBrief),
  SynthesisMemoResponse: component("SynthesisMemoResponse", raw.SynthesisMemoResponse),
};

// -------- shared error envelope --------

const ErrorResponse = component(
  "ErrorResponse",
  z.object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  }),
);

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ErrorResponse } },
});

const flatErrorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: z.object({ error: z.string() }) } },
});

const quotaExceededResponse = {
  description:
    "Free-tier generation quota spent. Clients must present the paywall, not a generic error.",
  content: { "application/json": { schema: S.QuotaExceeded } },
};

const errorResponses = {
  400: errorResponse("Bad request — validation failed against the zod schema."),
  401: errorResponse("Missing or invalid session token."),
  402: quotaExceededResponse,
  429: errorResponse("Rate limit exceeded (per-user or per-ip)."),
  500: errorResponse("Internal server error."),
};

// -------- security scheme --------

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description:
    "Session token issued by `POST /v1/auth/session`. Attach as `Authorization: Bearer <token>`.",
});

// -------- routes --------

registry.registerPath({
  method: "get",
  path: "/v1/health",
  summary: "Health check",
  description: "Liveness probe. Returns 200 while the API is accepting traffic.",
  tags: ["system"],
  responses: {
    200: {
      description: "Service is healthy.",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("ok"),
            uptime: z.number().describe("Seconds since process start"),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/identify",
  summary: "Identify investable brands from a photo",
  description:
    "Accepts a multipart image plus optional location. Runs the vision pipeline and returns detected brands with ticker / comparable / ETF annotations. See `packages/vision`.",
  tags: ["identify"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({
            image: z
              .string()
              .openapi({ type: "string", format: "binary" })
              .describe("Photo bytes (JPEG or PNG)."),
            location: S.LatLng.optional().describe(
              "Optional device location to bias identification.",
            ),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Identification succeeded.",
      content: { "application/json": { schema: S.IdentifyResponse } },
    },
    402: errorResponses[402],
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/finds",
  summary: "Finds journal for the signed-in user",
  description:
    "Every successful `/v1/identify` by a signed-in user records the top investable as a find. Returns finds newest-first.",
  tags: ["identify"],
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      limit: z.coerce
        .number()
        .optional()
        .openapi({ example: 100 })
        .describe("Max finds to return. Default 100, capped at 200."),
    }),
  },
  responses: {
    200: {
      description: "Finds returned newest-first.",
      content: { "application/json": { schema: S.FindsResponse } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/progress",
  summary: "Progression (XP, level, streak) for the signed-in user",
  description:
    "Server-side truth for XP, level, streak length, streak-freeze inventory, and earned `badges`. Written by `recordFind` on every successful `/v1/identify`; the client renders this rather than deriving a streak locally, so the streak survives reinstall. `lastFindDay` is a UTC calendar day (`YYYY-MM-DD`). `badges` holds opaque earned badge keys (e.g. `sector:Consumer Staples`) awarded server-side — clients never post a badge and must render an unknown key generically.",
  tags: ["identify"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Progression state returned.",
      content: { "application/json": { schema: S.ProgressResponse } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/universe/summary",
  summary: "Counterfactual universe portfolio",
  description:
    "The `$100 per find at found price` aggregate: what the caller's universe would be worth if $100 had gone into every find at the moment it was found. Computed from each find's `foundPrice` against the current quote. Finds without a `foundPrice` are excluded from the valued totals, never estimated (AGENTS.md §2.4). Hypothetical only — not a holdings statement. `sources` cites each quote provider that actually declared itself, with confidence derived from the quote's own freshness declaration (AGENTS.md §6 — a quote reporting no provider adds no citation rather than a fabricated one).",
  tags: ["identify"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Universe summary computed.",
      content: { "application/json": { schema: S.UniverseSummary } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/dex",
  summary: "Collection progress (sector dexes + regional tiles)",
  description:
    "Derived on read by reconciling the caller's finds against the `brands.json` seed in `packages/finance`: per-sector found/total counts, plus `tilesVisited` (distinct geohash-6 tiles with at least one find) and `rarityCounts`, the per-find histogram over the four `DexRarity` tiers. Every find is classified into exactly one tier, so the four counts sum to `totalFinds`.",
  tags: ["identify"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Dex progress returned.",
      content: { "application/json": { schema: S.DexResponse } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/quests",
  summary: "Daily quests for the signed-in user",
  description:
    "The caller's quest set for the current UTC day. Quests cover verifiable actions only (`catch_any`, `catch_private`, `new_tile`, `new_sector`) and are evaluated server-side from the find stream — completion is never self-reported, so there is no endpoint to claim one. `id` is deterministic per day and kind (`{YYYY-MM-DD}:{kind}`), which is what makes XP grantable at most once per quest. `xpGrantedToday` reports XP already written to `user_progress` for `day`; the client displays it and never adds to it.",
  tags: ["identify"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Quest set for the current UTC day.",
      content: { "application/json": { schema: S.QuestsResponse } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/territory",
  summary: "Tile completion for a location",
  description:
    "Completion state for the geohash-6 tile containing `lat`/`lng`. `investablesTotal` is how many investable brands the same nearby cascade behind `/v1/nearby` resolves inside the tile, and `found` is how many of those the caller has already caught, so the two reconcile with `/v1/nearby` for that tile. `pioneer` is true when the caller has not yet recorded a find in this tile — the write-time pioneer XP bonus is still available here. The counts come from a live places + brand join, so the response carries `sources` (AGENTS.md §6) — an uncitable lookup returns fewer sources, never an invented one.",
  tags: ["identify"],
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      lat: z.coerce.number().min(-90).max(90).openapi({ example: 40.7128 }),
      lng: z.coerce.number().min(-180).max(180).openapi({ example: -74.006 }),
    }),
  },
  responses: {
    200: {
      description: "Tile completion resolved.",
      content: { "application/json": { schema: S.TerritoryResponse } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/events/current",
  summary: "Currently open XP event, if any",
  description:
    "The scheduler-driven quest modifier that is open right now — e.g. Sector Saturday doubling XP for one sector, or an earnings-week window. The schedule is global rather than per-user, so no auth is required. `active` is explicitly `null` when no window is open, letting the client distinguish 'no event' from a failed fetch. The `multiplier` applies to find XP only (quest XP is awarded at face value), only inside `[startsAt, endsAt)`, and an event with no `sector` applies to every sector.",
  tags: ["identify"],
  responses: {
    200: {
      description: "Active event, or `null` when no window is open.",
      content: { "application/json": { schema: S.EventsResponse } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/rivalries",
  summary: "Weekly matchups for the signed-in user",
  description:
    "The caller's tracked solo matchups (e.g. NVDA vs AMD) with the running win/loss/draw record. Collection and comprehension mechanic only: a rivalry is not a position and the copy never instructs a trade. `weekStart` is the Monday of the current round as a UTC calendar day, so the round boundary does not move with the device timezone.",
  tags: ["identify"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Rivalries returned newest-first.",
      content: { "application/json": { schema: S.RivalriesResponse } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/rivalries",
  summary: "Start a weekly matchup against a comparable",
  description:
    "Creates a solo weekly matchup for one of the caller's finds. Omit `rivalTicker` and the server picks the opponent from the existing comparables pipeline in `packages/finance` — the client must not invent a rival, and a ticker with no resolvable comparable returns 422 rather than a fabricated opponent. The optional pre-registered `currentPick` on the returned rivalry is a conviction game scored for XP; it is not an order and creates no position.",
  tags: ["identify"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: S.CreateRivalryRequest },
      },
    },
  },
  responses: {
    201: {
      description: "Rivalry created; the full updated list is returned.",
      content: { "application/json": { schema: S.RivalriesResponse } },
    },
    409: flatErrorResponse("A rivalry for this exact pairing already exists."),
    422: flatErrorResponse(
      "No comparable could be resolved for `ticker` — pass an explicit `rivalTicker` instead.",
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/rivalries/{id}/pick",
  summary: "Pre-register (or clear) the conviction pick for the open round",
  description:
    'Body is `{ pick: "ticker" | "rival" | null }` — `null` clears the pick. A correct pick earns XP at the weekly close, which then clears it so a pick never carries into a round it was not registered for. Not an order; creates no position.',
  tags: ["identify"],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: "id", in: "path" } }),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ pick: z.enum(["ticker", "rival"]).nullable() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Pick recorded; the full updated list is returned.",
      content: { "application/json": { schema: S.RivalriesResponse } },
    },
    404: flatErrorResponse("Rivalry not found (or not the caller's)."),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/v1/rivalries/{id}",
  summary: "Delete a rivalry",
  tags: ["identify"],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ param: { name: "id", in: "path" } }),
    }),
  },
  responses: {
    204: { description: "Rivalry deleted." },
    404: flatErrorResponse("Rivalry not found (or not the caller's)."),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/nearby",
  summary: "Nearby investable places",
  description:
    "Google Places lookup around a lat/lng, filtered and annotated with tickers/ETFs. Every finance answer includes a `sources: Source[]` array (see AGENTS.md §6).",
  tags: ["nearby"],
  security: [{ bearerAuth: [] }],
  request: {
    query: raw.NearbyRequest,
  },
  responses: {
    200: {
      description: "Nearby items resolved.",
      content: { "application/json": { schema: S.NearbyResponse } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/widget/nearby",
  summary: "Trimmed nearby payload for home-screen widgets",
  description:
    "Same places cascade + brand join as `/v1/nearby`, capped small (max 12) with quotes attached for up to 6 tickers. Built for the iOS WidgetKit and Android home-screen widgets, which refresh on a timeline rather than on demand. No auth required.",
  tags: ["widget"],
  request: {
    query: raw.NearbyRequest,
  },
  responses: {
    200: {
      description: "Widget-sized nearby items resolved.",
      content: { "application/json": { schema: S.WidgetNearbyResponse } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/widget/map-snapshot",
  summary: "Static map PNG for home-screen widgets",
  description:
    "Server-rendered Google Static Maps PNG with a pin for the origin and one per nearby investable, labeled by ticker. Proxies the request so `GOOGLE_MAPS_API_KEY` never reaches a widget extension (see docs/SECRETS.md). Returns 501 when no key is configured.",
  tags: ["widget"],
  request: {
    query: raw.NearbyRequest.extend({
      width: z.coerce.number().optional().describe("PNG width in px, capped at 640."),
      height: z.coerce.number().optional().describe("PNG height in px, capped at 640."),
    }),
  },
  responses: {
    200: {
      description: "Map snapshot PNG.",
      content: {
        "image/png": { schema: z.string().openapi({ type: "string", format: "binary" }) },
      },
    },
    400: errorResponses[400],
    501: errorResponse("Map snapshot not configured (GOOGLE_MAPS_API_KEY unset)."),
    502: errorResponse("Upstream places lookup or static map request failed."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/resolve-comparable",
  summary: "Resolve a private brand to a public comparable + ETF exposure",
  description:
    "Given a brand name, returns the closest public comparable, ETF exposures, and cited sources. Confidence is `low` when the pipeline could not cite a source (do not fabricate).",
  tags: ["finance"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: S.ResolveComparableRequest },
      },
    },
  },
  responses: {
    200: {
      description: "Comparable resolved.",
      content: {
        "application/json": { schema: S.ResolveComparableResponse },
      },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/quote-history",
  summary: "Daily provider-routed price history",
  description:
    "Daily adjusted closes from the configured market-data provider for the native Overview price series. Period defaults to `1mo`. Does not invent prices — 502 when history is unavailable.",
  tags: ["finance"],
  request: {
    query: z.object({
      symbol: z.string().openapi({ example: "AAPL" }),
      period: z.enum(["1mo", "3mo", "6mo", "1y"]).optional().openapi({ example: "1mo" }),
    }),
  },
  responses: {
    200: {
      description: "Daily close series with provider source citation.",
      content: { "application/json": { schema: S.QuoteHistoryResponse } },
    },
    400: errorResponses[400],
    502: errorResponse("Market-data history unavailable."),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/chart/{type}",
  summary: "Underlying Analyzer chart image",
  description:
    "Proxies `POST /api/charts/{type}` on Underlying Analyzer. Period aliases `1m`/`1M` normalize to the sibling analyzer's `1mo` period.",
  tags: ["finance"],
  request: {
    params: z.object({
      type: z.string().openapi({
        param: { name: "type", in: "path" },
        example: "auction",
      }),
    }),
    query: z.object({
      ticker: z.string().openapi({ example: "MCD" }),
      period: z.string().optional().openapi({ example: "1mo" }),
      month: z.coerce.number().optional(),
    }),
  },
  responses: {
    200: {
      description: "Chart PNG as base64 plus optional auction levels.",
      content: { "application/json": { schema: S.ChartResponse } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/market-data/capabilities",
  summary: "Market-data provider capabilities",
  description:
    "Returns the configured primary provider, freshness declaration, subscription labels, and dataset capability notes. The subscription labels are operational configuration and are not inferred from API responses.",
  tags: ["finance"],
  responses: {
    200: {
      description: "Provider capability report.",
      content: { "application/json": { schema: S.MarketDataCapabilities } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/market-data/aggregates",
  summary: "Historical market aggregates",
  description:
    "Additive OHLCV aggregate endpoint backed by Massive when configured. Dates are YYYY-MM-DD; timestamps in points are Unix seconds. The endpoint returns an opaque `nextCursor` when the provider has another page.",
  tags: ["finance"],
  request: {
    query: z.object({
      symbol: z.string().openapi({ example: "AAPL" }),
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .openapi({ example: "2026-01-01" }),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .openapi({ example: "2026-01-31" }),
      multiplier: z.coerce.number().int().min(1).max(1_000).optional().openapi({ example: 1 }),
      timespan: z
        .enum(["minute", "hour", "day", "week", "month", "quarter", "year"])
        .optional()
        .openapi({ example: "day" }),
      adjusted: z.coerce.boolean().optional(),
      assetClass: z.enum(["stocks", "options"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "Aggregate bars.",
      content: { "application/json": { schema: S.AggregatesResponse } },
    },
    ...errorResponses,
    400: flatErrorResponse("Bad request."),
    429: flatErrorResponse("Market-data rate limit exceeded."),
    502: flatErrorResponse("Market-data aggregates unavailable."),
    503: flatErrorResponse("Market-data provider is not configured."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/financials/ratios",
  summary: "Financial ratios",
  description:
    "Additive financial-ratios page backed by the configured market-data provider. Continuation cursors are opaque and must be passed back unchanged.",
  tags: ["finance"],
  request: { query: S.FinancialRatiosRequest },
  responses: {
    200: {
      description: "Financial ratios page.",
      content: { "application/json": { schema: S.FinancialRatiosResponse } },
    },
    ...errorResponses,
    400: flatErrorResponse("Bad request."),
    429: flatErrorResponse("Market-data rate limit exceeded."),
    501: flatErrorResponse("Financial ratios are unsupported."),
    502: flatErrorResponse("Financial ratios unavailable."),
    503: flatErrorResponse("Market-data provider is not configured."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/options/summary",
  summary: "Option contract summary",
  description:
    "Additive single-contract snapshot backed by Massive options data, including normalized contract details, greeks, quote, trade, and day fields when available.",
  tags: ["finance"],
  request: { query: S.OptionSummaryRequest },
  responses: {
    200: {
      description: "Option summary.",
      content: { "application/json": { schema: S.OptionSummaryResponse } },
    },
    ...errorResponses,
    400: flatErrorResponse("Bad request."),
    404: flatErrorResponse("Option summary not found."),
    429: flatErrorResponse("Market-data rate limit exceeded."),
    501: flatErrorResponse("Option snapshots are unsupported."),
    502: flatErrorResponse("Option summary unavailable."),
    503: flatErrorResponse("Market-data provider is not configured."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/options/bars",
  summary: "Option contract bars",
  description:
    "Additive OHLCV bars for an options contract. The provider continuation cursor is opaque and must be passed back unchanged.",
  tags: ["finance"],
  request: { query: S.OptionBarsRequest },
  responses: {
    200: {
      description: "Option aggregate bars page.",
      content: { "application/json": { schema: S.OptionBarsResponse } },
    },
    ...errorResponses,
    400: flatErrorResponse("Bad request."),
    429: flatErrorResponse("Market-data rate limit exceeded."),
    501: flatErrorResponse("Option aggregates are unsupported."),
    502: flatErrorResponse("Option bars unavailable."),
    503: flatErrorResponse("Market-data provider is not configured."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/options/chain",
  summary: "Options chain snapshot",
  description:
    "Additive option-chain snapshot with Massive-normalized contracts, greeks, implied volatility, quotes, trades, and open interest when the subscribed Options plan includes them.",
  tags: ["finance"],
  request: {
    query: z.object({
      underlying: z.string().openapi({ example: "AAPL" }),
      expiration_date: z.string().optional(),
      contract_type: z.enum(["call", "put"]).optional(),
      strike_price: z.coerce.number().finite().optional(),
      limit: z.coerce.number().int().min(1).max(250).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Options chain page.",
      content: { "application/json": { schema: S.OptionsResponse } },
    },
    ...errorResponses,
    400: flatErrorResponse("Bad request."),
    429: flatErrorResponse("Market-data rate limit exceeded."),
    502: flatErrorResponse("Options chain unavailable."),
    503: flatErrorResponse("Market-data provider is not configured."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/options/contracts",
  summary: "Options contract reference data",
  description:
    "Additive, cursor-paginated options contract index. Massive exposes active and expired contracts with expiration dates, strikes, types, and exercise styles.",
  tags: ["finance"],
  request: {
    query: z.object({
      underlying: z.string().optional(),
      ticker: z.string().optional(),
      expiration_date: z.string().optional(),
      contract_type: z.enum(["call", "put"]).optional(),
      expired: z.coerce.boolean().optional(),
      as_of: z.string().optional(),
      strike_price: z.coerce.number().finite().optional(),
      limit: z.coerce.number().int().min(1).max(1_000).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Options contracts page.",
      content: { "application/json": { schema: S.OptionContractsResponse } },
    },
    ...errorResponses,
    400: flatErrorResponse("Bad request."),
    429: flatErrorResponse("Market-data rate limit exceeded."),
    502: flatErrorResponse("Options contracts unavailable."),
    503: flatErrorResponse("Market-data provider is not configured."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/options/contracts/{ticker}",
  summary: "Single options contract",
  description: "Additive options contract reference lookup by Massive options ticker.",
  tags: ["finance"],
  request: {
    params: z.object({
      ticker: z
        .string()
        .openapi({ param: { name: "ticker", in: "path" }, example: "O:AAPL260116C00100000" }),
    }),
  },
  responses: {
    200: {
      description: "Options contract.",
      content: {
        "application/json": {
          schema: z.object({ contract: S.OptionContract, sources: z.array(S.Source) }),
        },
      },
    },
    ...errorResponses,
    429: flatErrorResponse("Market-data rate limit exceeded."),
    502: flatErrorResponse("Options contract unavailable."),
    503: flatErrorResponse("Market-data provider is not configured."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/market-events",
  summary: "Corporate actions and market events",
  description:
    "Returns Massive stock splits and dividends, plus optional TMX/Wall Street Horizon corporate events when the partner dataset is enabled.",
  tags: ["finance"],
  request: {
    query: z.object({
      ticker: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.coerce.number().optional(),
    }),
  },
  responses: {
    200: {
      description: "Market events.",
      content: { "application/json": { schema: S.MarketEventsResponse } },
    },
    ...errorResponses,
    400: flatErrorResponse("Bad request."),
    429: flatErrorResponse("Market-data rate limit exceeded."),
    502: flatErrorResponse("Market events unavailable."),
    503: flatErrorResponse("Market-data provider is not configured."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/analysis/{ticker}",
  summary: "Underlying Analyzer snapshot",
  description:
    "Lightweight stock summary (+ brief when present). Full Anthropic brief via POST /v1/memo.",
  tags: ["finance"],
  request: {
    params: z.object({
      ticker: z.string().openapi({
        param: { name: "ticker", in: "path" },
        example: "MCD",
      }),
    }),
  },
  responses: {
    200: {
      description: "Analysis snapshot.",
      content: { "application/json": { schema: S.AnalysisSnapshot } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/graph/{ticker}",
  summary: "Company value-chain graph",
  description:
    "Cache-first: served from the `company_edges` store, extracted on miss with in-flight dedupe per ticker and refreshed when a new 10-K lands rather than on a short TTL. Cache hits are free and identity-less; a cache MISS spends provider money, so generation requires a bearer session or `X-Device-Id` and counts against the free-tier generation quota (402 when spent; concurrent callers sharing one in-flight extraction are charged once). Edges are cited from 10-K items 1/1A evidence (supplier concentration and >10% customers are disclosed there) plus Exa open-web results; every edge carries `sources` (AGENTS.md §6) and an edge that cannot be cited is not emitted. Private counterparties keep `dstName` with no `dstTicker` — never an invented one. Empty and failing extractions are negatively cached for an hour. Returns 502 when extraction fails.",
  tags: ["finance"],
  request: {
    params: z.object({
      ticker: z.string().openapi({
        param: { name: "ticker", in: "path" },
        example: "NVDA",
      }),
    }),
  },
  responses: {
    200: {
      description: "Graph edges returned (cache hit or fresh extraction).",
      content: { "application/json": { schema: S.CompanyGraphResponse } },
    },
    400: flatErrorResponse(
      "Bad request — malformed ticker, or a cache-miss generation attempted with neither a bearer session nor an `X-Device-Id` header.",
    ),
    402: quotaExceededResponse,
    429: flatErrorResponse("Rate limit exceeded."),
    502: flatErrorResponse("Graph extraction failed (filings or Exa evidence unavailable)."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/pulse/{ticker}",
  summary: "Demand pulse (is the money upstream growing or shrinking)",
  description:
    "Aggregates the buyer side of a ticker's value chain into one signal: the `buys_from` counterparties from `/v1/graph/{ticker}` joined to provider income-statement / cash-flow series, weighted by edge weight. Metered exactly like `/v1/graph` — cache hits are free and identity-less; a cache MISS spends provider money, so generation requires a bearer session or `X-Device-Id` and counts against the free-tier generation quota (402 when spent). `pulse` is `null` (and `interpretation` is `unknown`) when no buyer fundamentals resolved — never zero-filled — and a buyer whose series is missing keeps `revenueYoY`/`capexYoY` omitted (AGENTS.md §2.4). Every fetched series is cited in `sources` (AGENTS.md §6).",
  tags: ["finance"],
  request: {
    params: z.object({
      ticker: z.string().openapi({
        param: { name: "ticker", in: "path" },
        example: "NVDA",
      }),
    }),
  },
  responses: {
    200: {
      description: "Demand pulse returned (cache hit or fresh computation).",
      content: { "application/json": { schema: S.DemandPulse } },
    },
    400: flatErrorResponse(
      "Bad request — malformed ticker, or a cache-miss generation attempted with neither a bearer session nor an `X-Device-Id` header.",
    ),
    402: quotaExceededResponse,
    429: flatErrorResponse("Rate limit exceeded."),
    502: flatErrorResponse("Demand pulse unavailable (graph edges or fundamentals unreachable)."),
    503: flatErrorResponse("Market-data provider is not configured."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/environment/{sector}",
  summary: "Macro environment brief for a sector",
  description:
    "The gather → LLM → tailwinds/headwinds brief at sector scale, cached 24h. `series` holds the quantitative FRED observations behind the brief; policy and culture color gathered via Exa with recency filters is qualitative and is cited in `sources` alongside them, never promoted into `series`. Metered exactly like `/v1/graph` — cache hits are free, a cache MISS requires a bearer session or `X-Device-Id` and counts against the free-tier generation quota (402 when spent). Degrades honestly: with `FRED_API_KEY` unset the brief ships with `series: []` and Exa color only; 503 only when neither FRED nor Exa (nor the LLM) is configured. Macro numbers are never synthesized.",
  tags: ["finance"],
  request: {
    params: z.object({
      sector: z.string().openapi({
        param: { name: "sector", in: "path" },
        example: "Consumer Staples",
      }),
    }),
  },
  responses: {
    200: {
      description: "Environment brief returned (cache hit or fresh generation).",
      content: { "application/json": { schema: S.EnvironmentBrief } },
    },
    400: flatErrorResponse(
      "Bad request — unknown sector, or a cache-miss generation attempted with neither a bearer session nor an `X-Device-Id` header.",
    ),
    402: quotaExceededResponse,
    429: flatErrorResponse("Rate limit exceeded."),
    502: flatErrorResponse("Environment brief generation failed."),
    503: flatErrorResponse(
      "Environment layer not configured (neither FRED_API_KEY nor EXA_API_KEY, or no LLM key).",
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/memo/synthesis",
  summary: "Layered synthesis memo (billable)",
  description:
    "The layered memo. The prompt receives the three layer briefs — upstream (`/v1/graph/{ticker}`), demand (`/v1/pulse/{ticker}`), and environment (`/v1/environment/{sector}`) — plus ratios, and is asked exactly three questions: what is the binding constraint on this business, how durable is the demand above it, and where in the chain does pricing power sit. Those answers come back as `bindingConstraint` / `demandDurability` / `pricingPower`, each grounded in the cited layer briefs. They are optional because the memo degrades gracefully: with an empty graph, no pulse, and no environment brief it returns a plain `memo` and omits the layer answers rather than guessing them. Metered exactly like `/v1/graph` — cache hits are free, a cache MISS requires a bearer session or `X-Device-Id` and counts against the free-tier generation quota (402 when spent). Every layer fact carried into an answer is cited in `sources` (AGENTS.md §6).",
  tags: ["finance"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ ticker: z.string().openapi({ example: "NVDA" }) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Synthesis memo generated (cache hit or fresh generation).",
      content: { "application/json": { schema: S.SynthesisMemoResponse } },
    },
    400: flatErrorResponse(
      "Bad request — malformed ticker, or a cache-miss generation attempted with neither a bearer session nor an `X-Device-Id` header.",
    ),
    402: quotaExceededResponse,
    429: flatErrorResponse("Rate limit exceeded."),
    502: flatErrorResponse("Memo generation failed."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/cockpit",
  summary: "Watchlist cockpit (Underlying Analyzer)",
  description: "Batch rank for up to 10 tickers via POST /api/watchlists/cockpit.",
  tags: ["finance"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            tickers: z.array(z.string()).min(1).max(10),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Ranked cockpit rows.",
      content: { "application/json": { schema: S.CockpitResponse } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/alerts",
  summary: "Watchlist alerts digest (Underlying Analyzer)",
  description: "Alert digest for up to 10 tickers via POST /api/watchlists/alerts.",
  tags: ["finance"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            tickers: z.array(z.string()).min(1).max(10),
            maxAlerts: z.number().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Alerts digest.",
      content: { "application/json": { schema: S.AlertsResponse } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/agent/chat",
  summary: "Start or continue a durable research conversation",
  description:
    "Uses Derivation Research Console /api/explore in agent mode, then returns its display projection as an article-shaped turn. Follow-ups reuse conversationId and one clientMessageId per user message. Broker orders stay disabled.",
  tags: ["finance"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: S.AgentChatRequest,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Completed research turn and durable conversation reference.",
      content: { "application/json": { schema: S.AgentChatResponse } },
    },
    202: {
      description: "Conversation accepted and still running; recover through the status endpoint.",
      content: { "application/json": { schema: S.AgentChatResponse } },
    },
    404: errorResponse("Conversation does not belong to this caller or no longer exists."),
    409: errorResponse("Conversation is blocked or has exhausted its iteration budget."),
    502: errorResponse("Research Console returned an invalid response or failed."),
    503: errorResponse("Research Console configuration or service is unavailable."),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/agent/threads",
  summary: "List persisted research brief threads",
  description: "Lists the caller's Mapvest-owned durable conversation references.",
  tags: ["finance"],
  responses: {
    200: {
      description: "Thread summaries.",
      content: {
        "application/json": {
          schema: z.object({
            threads: z.array(S.AgentThreadSummary),
            count: z.number(),
            sourceUrl: z.string().url().optional(),
          }),
        },
      },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/agent/threads/{id}/status",
  summary: "Get lightweight durable research status",
  description: "Uses Derivation GET /api/autoresearch?summary=1 for an owned conversation.",
  tags: ["finance"],
  request: {
    params: z.object({
      id: z.string().openapi({
        param: { name: "id", in: "path" },
      }),
    }),
  },
  responses: {
    200: {
      description: "Conversation status and progress.",
      content: { "application/json": { schema: S.AgentConversationStatus } },
    },
    404: errorResponse("Conversation does not belong to this caller or no longer exists."),
    502: errorResponse("Research Console status recovery failed."),
    503: errorResponse("Research Console configuration or service is unavailable."),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/agent/threads/{id}/memo",
  summary: "Download a completed research memo",
  description:
    "Owner-scoped PDF proxy for the durable conversation memo; the Console service credential remains server-only.",
  tags: ["finance"],
  request: {
    params: z.object({
      id: z.string().openapi({
        param: { name: "id", in: "path" },
      }),
    }),
  },
  responses: {
    200: {
      description: "Completed research memo PDF.",
      content: {
        "application/pdf": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
      },
    },
    404: errorResponse("Conversation or completed memo does not exist for this caller."),
    502: errorResponse("Research Console memo recovery failed."),
    503: errorResponse("Research Console configuration or service is unavailable."),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/agent/threads/{id}",
  summary: "Get one research brief thread",
  description: "Uses Derivation GET /api/autoresearch?display=1 for an owned conversation.",
  tags: ["finance"],
  request: {
    params: z.object({
      id: z.string().openapi({
        param: { name: "id", in: "path" },
      }),
    }),
  },
  responses: {
    200: {
      description: "Full thread with messages.",
      content: {
        "application/json": {
          schema: z.object({ thread: S.AgentThreadSummary }),
        },
      },
    },
    404: errorResponse("Conversation does not belong to this caller or no longer exists."),
    502: errorResponse("Research Console display recovery failed."),
    503: errorResponse("Research Console configuration or service is unavailable."),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/auth/session",
  summary: "Passwordless email sign-in (magic link)",
  description:
    "Starts or completes a magic-link session. On first call with `{email}`, an email is dispatched. On second call with `{email, code}`, a session token is returned.",
  tags: ["auth"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            email: z.string().email(),
            code: z
              .string()
              .optional()
              .describe("Magic-link code from the email. Omit on the first call to trigger send."),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Session issued or magic-link dispatched.",
      content: {
        "application/json": {
          schema: z.union([
            z.object({ sent: z.literal(true) }),
            z.object({ session: S.Session, user: S.User }),
          ]),
        },
      },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/entitlements",
  summary: "Free-tier remaining + plan",
  description:
    "Auth optional. Anonymous callers send `X-Device-Id` so remaining generations can be tracked per device. Mirrors the state `requireGenerationQuota` consumes.",
  tags: ["billing"],
  responses: {
    200: {
      description: "Current entitlement state.",
      content: { "application/json": { schema: S.EntitlementState } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/billing/checkout",
  summary: "Start a $19.99/mo subscription",
  description:
    "Signed-in only. `platform` selects the charge channel: Stripe Checkout URL for web (and iOS/Android until native product ids are configured), or `apple_iap` / `google_play` product ids once those env vars are set. Clients must not invent payment URLs.",
  tags: ["billing"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: false,
      content: {
        "application/json": { schema: S.BillingCheckoutRequest },
      },
    },
  },
  responses: {
    200: {
      description: "Checkout intent for the resolved channel.",
      content: { "application/json": { schema: S.BillingCheckoutResponse } },
    },
    401: errorResponses[401],
    503: errorResponse("Billing not configured (Stripe keys or native product id missing)."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/billing/portal",
  summary: "Stripe customer portal (manage / cancel)",
  description:
    "Signed-in Stripe subscribers only. Native-store subscribers manage billing in App Store / Play, not here.",
  tags: ["billing"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Portal URL.",
      content: { "application/json": { schema: S.BillingPortalResponse } },
    },
    400: errorResponse("No Stripe customer on file — subscribe first."),
    401: errorResponses[401],
    503: errorResponse("Billing not configured."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/billing/apple",
  summary: "Redeem a StoreKit 2 transaction",
  description:
    "Signed-in only. Body is the JWS from StoreKit (`purchase.purchaseToken` on iOS). The API verifies Apple's ES256 + x5c chain against Apple Root CA G3, then sets `plan=subscribed`. Native subscribers manage billing in the App Store, not Stripe portal.",
  tags: ["billing"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: S.BillingAppleRequest },
      },
    },
  },
  responses: {
    200: {
      description: "Updated entitlement state.",
      content: { "application/json": { schema: S.EntitlementState } },
    },
    400: errorResponse("Invalid, expired, revoked, or untrusted Apple JWS."),
    401: errorResponses[401],
    409: errorResponse("This Apple transaction is already linked to another Mapvest account."),
  },
});

registry.registerPath({
  method: "post",
  path: "/v1/memo",
  summary: "Generate a ticker memo (billable)",
  description:
    "Full research memo for a ticker. Counts against the 50-generation free tier. Returns 402 `quota_exceeded` when the meter is spent.",
  tags: ["finance"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ ticker: z.string() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Memo generated.",
      content: {
        "application/json": {
          schema: z.object({
            ticker: z.string(),
            provider: z.string(),
            memo: z.string(),
          }),
        },
      },
    },
    402: errorResponses[402],
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/admin/metrics",
  summary: "Admin: request + cost metrics",
  description:
    "Requires the `admin` scope. Returns rolling counters for identify/nearby/resolve calls and OpenRouter cost telemetry.",
  tags: ["admin"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Metrics snapshot.",
      content: {
        "application/json": {
          schema: z.object({
            requests: z.record(z.string(), z.number()),
            costUsd: z.number(),
            windowSeconds: z.number(),
          }),
        },
      },
    },
    401: errorResponses[401],
    403: errorResponse("Caller lacks the `admin` scope."),
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/admin/users",
  summary: "Admin: list users",
  description: "Requires the `admin` scope. Returns registered users.",
  tags: ["admin"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "User list.",
      content: {
        "application/json": {
          schema: z.object({ users: z.array(S.User) }),
        },
      },
    },
    401: errorResponses[401],
    403: errorResponse("Caller lacks the `admin` scope."),
  },
});

// -------- generate + write --------

const generator = new OpenApiGeneratorV31(registry.definitions);

const document = generator.generateDocument({
  openapi: "3.1.0",
  info: {
    title: "Mapvest API",
    version: "0.1.0-alpha.0",
    description:
      "Mapvest turns places and objects into investable tickers. All request and response shapes are generated from zod schemas in `packages/core/src/schemas` — never hand-edit `openapi.yaml`.",
    contact: { name: "Mapvest", url: "https://github.com/jawauntb/mapvest" },
    license: { name: "UNLICENSED" },
  },
  servers: [
    { url: "http://localhost:3001", description: "Local dev" },
    {
      url: "https://mapvest-api.up.railway.app",
      description: "Railway (staging/production)",
    },
  ],
  tags: [
    { name: "system", description: "Health + system endpoints" },
    { name: "identify", description: "Photo → investable identification" },
    { name: "nearby", description: "Location-driven place lookup" },
    { name: "widget", description: "Home-screen widget data (iOS WidgetKit / Android App Widget)" },
    { name: "finance", description: "Ticker / comparable / ETF resolution" },
    { name: "auth", description: "Passwordless email sign-in" },
    { name: "billing", description: "Entitlements + $19.99/mo subscription checkout" },
    { name: "admin", description: "Requires the `admin` scope" },
  ],
  security: [{ bearerAuth: [] }],
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const outPath = resolve(repoRoot, "openapi.yaml");

const yaml = `# GENERATED FILE — do not edit by hand.
# Source: packages/core/src/schemas/*.ts
# Regenerate: bun run openapi
${yamlStringify(document, { lineWidth: 0, aliasDuplicateObjects: false })}`;

writeFileSync(outPath, yaml, "utf8");

console.log(`openapi: wrote ${outPath}`);
