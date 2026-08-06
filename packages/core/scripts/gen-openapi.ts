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
  PhotoIdentification: component(
    "PhotoIdentification",
    raw.PhotoIdentification,
  ),
  IdentifyRequest: component("IdentifyRequest", raw.IdentifyRequest),
  IdentifyResponse: component("IdentifyResponse", raw.IdentifyResponse),
  NearbyRequest: component("NearbyRequest", raw.NearbyRequest),
  NearbyItem: component("NearbyItem", raw.NearbyItem),
  NearbyResponse: component("NearbyResponse", raw.NearbyResponse),
  WidgetNearbyItem: component("WidgetNearbyItem", raw.WidgetNearbyItem),
  WidgetNearbyResponse: component(
    "WidgetNearbyResponse",
    raw.WidgetNearbyResponse,
  ),
  ResolveComparableRequest: component(
    "ResolveComparableRequest",
    raw.ResolveComparableRequest,
  ),
  ResolveComparableResponse: component(
    "ResolveComparableResponse",
    raw.ResolveComparableResponse,
  ),
  ChartResponse: component("ChartResponse", raw.ChartResponse),
  AnalysisSnapshot: component("AnalysisSnapshot", raw.AnalysisSnapshot),
  CockpitResponse: component("CockpitResponse", raw.CockpitResponse),
  AlertsResponse: component("AlertsResponse", raw.AlertsResponse),
  AgentChatRequest: component("AgentChatRequest", raw.AgentChatRequest),
  AgentChatResponse: component("AgentChatResponse", raw.AgentChatResponse),
  AgentThreadSummary: component("AgentThreadSummary", raw.AgentThreadSummary),
  ResearchArticle: component("ResearchArticle", raw.ResearchArticle),
  User: component("User", raw.User),
  Session: component("Session", raw.Session),
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

const errorResponses = {
  400: errorResponse("Bad request — validation failed against the zod schema."),
  401: errorResponse("Missing or invalid session token."),
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
  description:
    "Liveness probe. Returns 200 while the API is accepting traffic.",
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
      content: { "image/png": { schema: z.string().openapi({ type: "string", format: "binary" }) } },
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
  path: "/v1/chart/{type}",
  summary: "Underlying Analyzer chart image",
  description:
    "Proxies `POST /api/charts/{type}` on Underlying Analyzer. Period aliases `1m`/`1M` normalize to yfinance `1mo`.",
  tags: ["finance"],
  request: {
    params: z.object({
      type: z
        .string()
        .openapi({
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
  path: "/v1/analysis/{ticker}",
  summary: "Underlying Analyzer snapshot",
  description: "Lightweight stock summary (+ brief when present). Full Anthropic brief via POST /v1/memo.",
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
  summary: "Ticker-bound research brief (Derivation idea-chats)",
  description:
    "Aggregates Derivation Research Console SSE into one article-shaped assistant turn. Product IA: open from ticker Research…; history under Saved → Briefs. Factory/Jobs UI not exposed. Broker orders off.",
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
      description: "Research article + optional thread id.",
      content: { "application/json": { schema: S.AgentChatResponse } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/v1/agent/threads",
  summary: "List persisted research brief threads",
  description: "Proxies Derivation GET /api/idea-chats. Shown under Saved → Briefs.",
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
  path: "/v1/agent/threads/{id}",
  summary: "Get one research brief thread",
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
              .describe(
                "Magic-link code from the email. Omit on the first call to trigger send.",
              ),
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
