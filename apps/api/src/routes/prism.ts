import { PrismBuildRequest, PrismChatRequest } from "@mapvest/core";
import { type Context, Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import {
  PRISM_UPSTREAM_URL,
  PrismUpstreamError,
  buildPrismPacket,
  chatWithPrism,
  exportPrismPacket,
  getPrismPacket,
  getPrismSummary,
  normalizePrismChatResponse,
  normalizePrismExportFormat,
  normalizePrismTicker,
  prismExportContentType,
  prismExportFilename,
} from "../lib/prism.js";
import { optionalAuth } from "../middleware/optionalAuth.js";
import {
  deviceIdFromRequest,
  requireGenerationQuota,
} from "../middleware/requireGenerationQuota.js";

/**
 * Prism (working name "ubermemo") — the full-stack memo engine, proxied.
 *
 * Mounted twice in `index.ts`: at `/v1/prism` and at the working-name alias
 * `/v1/ubermemo`. Both hit the same handlers, exactly as the engine aliases
 * `/api/prism` and `/api/ubermemo`.
 *
 * These are thin proxies (AGENTS.md §3: "no business logic beyond glue"). The
 * packet is passed through verbatim — Mapvest does not re-validate the engine's
 * analytical sections, because a strict gate here would turn an engine schema
 * addition into a 502 for every client. The zod contract in `packages/core`
 * (`PrismPacket`) is what clients parse against, and its analytical sections
 * are passthrough for the same reason.
 *
 * Metering: `POST /v1/prism` is the one route that can run the whole engine
 * plus an Anthropic memo, so it carries `requireGenerationQuota("memo")` — the
 * same meter kind as `POST /v1/memo`, since to a user they are one "memo"
 * generation. It is metered idempotently (see {@link prismBuildQuota}) because
 * the engine short-circuits a repeat non-forced build and spends nothing.
 *
 * Reads, the summary projection, and exports of an already-built packet are
 * free: they touch stored bytes only. `POST /v1/prism/chat` is *not* free — it
 * costs one Anthropic completion upstream — but it is not a generation either,
 * so it is capped by {@link chatRateLimit} per identity instead of by the
 * generation meter.
 */
const prism = new Hono();

type ErrorBody = Readonly<{ error: string; code: string; upstreamStatus?: number }>;

type MappedError = Readonly<{
  status: 400 | 404 | 429 | 502 | 503 | 504;
  body: ErrorBody;
  retryAfter?: string;
}>;

function upstreamDetail(body: unknown): string | undefined {
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 400);
  if (body && typeof body === "object") {
    const value = (body as Record<string, unknown>).error;
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 400);
  }
  return undefined;
}

/**
 * Maps an engine failure onto a client-meaningful status. 404 and 429/503 are
 * forwarded because they are real, actionable states (no packet yet; engine
 * busy — the engine bounds Prism concurrency and answers with `Retry-After`).
 * Every other upstream code collapses to 502: an engine-side 401/403/500 is a
 * Mapvest↔engine problem and must not look like a caller error.
 */
function mapError(error: unknown): MappedError {
  if (error instanceof PrismUpstreamError) {
    const detail = upstreamDetail(error.body);
    if (error.status === 404) {
      return {
        status: 404,
        body: {
          error: detail ?? "no Prism packet for this ticker yet — POST /v1/prism to build one",
          code: "prism_packet_not_found",
        },
      };
    }
    if (error.status === 400) {
      return {
        status: 400,
        body: { error: detail ?? "Prism engine rejected the request", code: "prism_bad_request" },
      };
    }
    if (error.status === 429 || error.status === 503) {
      return {
        status: error.status,
        body: {
          error: detail ?? "Prism engine is busy; retry shortly",
          code: "prism_busy",
          upstreamStatus: error.status,
        },
        ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
      };
    }
    if (error.status === 504) {
      return {
        status: 504,
        body: {
          error: detail ?? "Prism engine timed out",
          code: "prism_timeout",
        },
      };
    }
    return {
      status: 502,
      body: {
        error: "Prism engine is unavailable",
        code: "prism_upstream_failed",
        upstreamStatus: error.status,
      },
    };
  }
  return {
    status: 502,
    body: {
      error: error instanceof Error ? error.message : "Prism request failed",
      code: "prism_request_failed",
    },
  };
}

function fail(c: Context, error: unknown): Response {
  const mapped = mapError(error);
  if (mapped.retryAfter) c.header("Retry-After", mapped.retryAfter);
  return c.json(mapped.body, mapped.status);
}

/** UTC calendar day — the granularity the engine's own packet cache uses. */
function buildDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Idempotency key for the build meter.
 *
 * The engine returns today's already-built packet for a non-forced build
 * (`app/prism/engine.py`: it answers from the store with
 * `meta.cache.packet == "hit"`, no provider calls, no Anthropic call, no
 * cost). Metering that would let a client burn its whole free tier on cache
 * hits — and both the iOS screen and the documented poll-around-a-long-build
 * flow re-POST the same ticker. So a non-forced build is keyed by
 * `prism:{ticker}:{utc day}` and charged at most once per ticker per day;
 * `hasRecordedGeneration` in the quota middleware makes the repeat free.
 *
 * A forced rebuild gets no key on purpose: `force: true` really does re-run
 * the engine and re-write the memo, so every one of those is a generation.
 */
export const prismBuildQuota = requireGenerationQuota("memo", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (raw?.force === true) return undefined;
  const ticker = normalizePrismTicker(typeof raw?.ticker === "string" ? raw.ticker : null);
  return ticker ? `prism:${ticker}:${buildDay()}` : undefined;
});

/**
 * POST /v1/prism  { ticker, force?, includeMemo? } → PrismPacket
 *
 * Billable. A cold build runs the whole engine and can take 1–3 minutes, hence
 * the 180s upstream budget in lib/prism.ts; clients should render staged
 * progress and may fall back to polling `GET /v1/prism/:ticker`.
 */
prism.post("/", optionalAuth, prismBuildQuota, async (c) => {
  return safeExecuteWithSpan("http.prism.build", async (span) => {
    const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    // Accept the engine's snake_case spelling too, so a caller holding the
    // upstream contract does not silently lose the flag.
    const parsed = PrismBuildRequest.safeParse({
      ticker: raw?.ticker,
      ...(raw?.force === undefined ? {} : { force: raw.force }),
      ...(raw?.includeMemo === undefined && raw?.include_memo === undefined
        ? {}
        : { includeMemo: raw?.includeMemo ?? raw?.include_memo }),
    });
    if (!parsed.success) {
      span.setAttribute("error.kind", "invalid_request");
      return c.json({ error: "ticker required", code: "prism_bad_request" }, 400);
    }
    const ticker = normalizePrismTicker(parsed.data.ticker);
    if (!ticker) {
      span.setAttribute("error.kind", "invalid_ticker");
      return c.json({ error: "invalid ticker", code: "prism_bad_request" }, 400);
    }
    span.setAttributes({
      ticker,
      force: Boolean(parsed.data.force),
      include_memo: parsed.data.includeMemo !== false,
    });

    const started = performance.now();
    try {
      const packet = await buildPrismPacket({
        ticker,
        ...(parsed.data.force === undefined ? {} : { force: parsed.data.force }),
        ...(parsed.data.includeMemo === undefined ? {} : { includeMemo: parsed.data.includeMemo }),
      });
      span.setAttribute("upstream_latency_ms", Math.round(performance.now() - started));
      return c.json(packet as Record<string, unknown>);
    } catch (error) {
      span.setAttributes({
        error_kind: "upstream",
        upstream_latency_ms: Math.round(performance.now() - started),
      });
      return fail(c, error);
    }
  });
});

/**
 * Per-identity cap on chat turns.
 *
 * A chat turn produces no new analysis, but it is not free: upstream,
 * `app/prism/chat.py::chat_turn` sends the ~22k-character packet projection
 * plus the memo excerpt to Anthropic and asks for up to 1600 tokens back, on
 * the same key `POST /v1/prism` is metered for. Left ungated, an anonymous
 * caller could spend that in a loop.
 *
 * It is deliberately not the generation meter: 50 lifetime generations is the
 * budget for building packets, and charging a full generation per question
 * would make the packet unquestionable. A per-identity window is the right
 * shape — generous for a person reading one memo, useless for a script.
 *
 * The global `rateLimit` middleware cannot do this job: its buckets are keyed
 * by identity alone and are already consumed by every other route the client
 * calls, so a tight limit mounted here would fire on unrelated traffic.
 */
export const PRISM_CHAT_LIMIT = 30;
export const PRISM_CHAT_WINDOW_MS = 60 * 60 * 1000;

type ChatBucket = { count: number; resetAt: number };
const chatBuckets = new Map<string, ChatBucket>();

/** Test-only helper, mirroring `__resetRateLimit` in middleware/rateLimit.ts. */
export function __resetPrismChatLimit(): void {
  chatBuckets.clear();
}

/**
 * `null` when the caller is within their window; the seconds to wait when they
 * are not. Counts the turn as taken, so a refused turn still holds the window
 * shut — the point is to stop a loop, not to be fair to one.
 */
function takeChatTurn(identity: string, now: number = Date.now()): number | null {
  const bucket = chatBuckets.get(identity);
  if (!bucket || bucket.resetAt <= now) {
    chatBuckets.set(identity, { count: 1, resetAt: now + PRISM_CHAT_WINDOW_MS });
    return null;
  }
  bucket.count += 1;
  if (bucket.count > PRISM_CHAT_LIMIT) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  }
  return null;
}

/**
 * POST /v1/prism/chat  { ticker, message, conversationId?, history? }
 *   → PrismChatResponse
 *
 * Answers strictly from the stored packet, so it 404s when nothing has been
 * built for the ticker. It does not spend a generation, but it *does* spend one
 * Anthropic completion upstream per turn, so it requires an identity (a signed
 * session or `X-Device-Id`, the same identity the quota middleware meters by)
 * and is capped at {@link PRISM_CHAT_LIMIT} turns per identity per hour.
 */
prism.post("/chat", optionalAuth, async (c) => {
  return safeExecuteWithSpan("http.prism.chat", async (span) => {
    // The spend has to be attributable to somebody before it is made.
    const user = (c as unknown as { get: (k: string) => { id?: string } | undefined }).get("user");
    const device = deviceIdFromRequest(c);
    const identity = user?.id ? `u:${user.id}` : device ? `d:${device}` : null;
    if (!identity) {
      span.setAttribute("error.kind", "no_identity");
      return c.json({ error: "X-Device-Id header required for anonymous requests" }, 400);
    }
    const retryAfter = takeChatTurn(identity);
    if (retryAfter !== null) {
      span.setAttribute("error.kind", "chat_rate_limited");
      c.header("Retry-After", String(retryAfter));
      return c.json(
        {
          error: `too many Prism chat turns; retry in ${retryAfter}s`,
          code: "prism_chat_rate_limited",
          limit: PRISM_CHAT_LIMIT,
          retryAfter,
        },
        429,
      );
    }

    const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const parsed = PrismChatRequest.safeParse({
      ticker: raw?.ticker,
      message: raw?.message,
      ...(raw?.conversationId === undefined && raw?.conversation_id === undefined
        ? {}
        : { conversationId: raw?.conversationId ?? raw?.conversation_id }),
      ...(raw?.history === undefined ? {} : { history: raw.history }),
    });
    if (!parsed.success) {
      span.setAttribute("error.kind", "invalid_request");
      return c.json(
        { error: "ticker and message (1–4000 chars) required", code: "prism_bad_request" },
        400,
      );
    }
    const ticker = normalizePrismTicker(parsed.data.ticker);
    if (!ticker) {
      span.setAttribute("error.kind", "invalid_ticker");
      return c.json({ error: "invalid ticker", code: "prism_bad_request" }, 400);
    }
    span.setAttributes({ ticker, has_history: Boolean(parsed.data.history?.length) });

    try {
      const reply = await chatWithPrism({
        ticker,
        message: parsed.data.message,
        ...(parsed.data.conversationId ? { conversationId: parsed.data.conversationId } : {}),
        ...(parsed.data.history ? { history: parsed.data.history } : {}),
      });
      return c.json(normalizePrismChatResponse(reply, ticker));
    } catch (error) {
      span.setAttribute("error_kind", "upstream");
      return fail(c, error);
    }
  });
});

/**
 * GET /v1/prism/:ticker/summary → the bounded agent projection of the packet.
 * This is what `routes/agent.ts` injects into a research prompt, and what a
 * lightweight client can render without pulling the whole packet.
 */
prism.get("/:ticker/summary", async (c) => {
  return safeExecuteWithSpan("http.prism.summary", async (span) => {
    const ticker = normalizePrismTicker(c.req.param("ticker"));
    if (!ticker) {
      span.setAttribute("error.kind", "invalid_ticker");
      return c.json({ error: "invalid ticker", code: "prism_bad_request" }, 400);
    }
    span.setAttribute("ticker", ticker);
    try {
      const summary = await getPrismSummary(ticker);
      return c.json(summary as Record<string, unknown>);
    } catch (error) {
      span.setAttribute("error_kind", "upstream");
      return fail(c, error);
    }
  });
});

/**
 * GET /v1/prism/:ticker/export?format=txt|json|pdf
 *
 * Streams the engine's bytes through unbuffered with an explicit content type
 * and a `Content-Disposition` attachment name, so `expo-file-system` on iOS can
 * download straight to a share sheet. `private, no-store` because a packet is
 * a per-caller research artifact, not a cacheable public document.
 */
prism.get("/:ticker/export", async (c) => {
  return safeExecuteWithSpan("http.prism.export", async (span) => {
    const ticker = normalizePrismTicker(c.req.param("ticker"));
    if (!ticker) {
      span.setAttribute("error.kind", "invalid_ticker");
      return c.json({ error: "invalid ticker", code: "prism_bad_request" }, 400);
    }
    const format = normalizePrismExportFormat(c.req.query("format"));
    if (!format) {
      span.setAttribute("error.kind", "invalid_format");
      return c.json(
        { error: "format must be one of txt, json, pdf", code: "prism_bad_request" },
        400,
      );
    }
    span.setAttributes({ ticker, format });

    try {
      const upstream = await exportPrismPacket(ticker, format);
      const headers = new Headers({
        "Content-Type": upstream.headers.get("content-type") ?? prismExportContentType(format),
        "Content-Disposition":
          upstream.headers.get("content-disposition") ??
          `attachment; filename="${prismExportFilename(ticker, format)}"`,
        "Cache-Control": "private, no-store",
      });
      const length = upstream.headers.get("content-length");
      if (length) headers.set("Content-Length", length);
      return new Response(upstream.body, { status: 200, headers });
    } catch (error) {
      span.setAttribute("error_kind", "upstream");
      return fail(c, error);
    }
  });
});

/**
 * GET /v1/prism/:ticker → the latest stored packet, or 404 when none exists.
 * Free and identity-less: reading a packet spends no provider money. Clients
 * poll this while `POST /v1/prism` is running.
 */
prism.get("/:ticker", async (c) => {
  return safeExecuteWithSpan("http.prism.get", async (span) => {
    const ticker = normalizePrismTicker(c.req.param("ticker"));
    if (!ticker) {
      span.setAttribute("error.kind", "invalid_ticker");
      return c.json({ error: "invalid ticker", code: "prism_bad_request" }, 400);
    }
    span.setAttribute("ticker", ticker);
    try {
      const packet = await getPrismPacket(ticker);
      return c.json(packet as Record<string, unknown>);
    } catch (error) {
      span.setAttribute("error_kind", "upstream");
      return fail(c, error);
    }
  });
});

/** GET /v1/prism → what this surface is and where the engine lives. */
prism.get("/", (c) =>
  c.json({
    name: "Prism",
    alias: "ubermemo",
    engine: PRISM_UPSTREAM_URL,
    note: "POST /v1/prism { ticker } to build a packet; GET /v1/prism/{ticker} to read the latest.",
    routes: [
      "POST /v1/prism",
      "GET /v1/prism/{ticker}",
      "GET /v1/prism/{ticker}/summary",
      "POST /v1/prism/chat",
      "GET /v1/prism/{ticker}/export?format=txt|json|pdf",
    ],
    disclaimer: "Research only. Not investment advice.",
  }),
);

export default prism;
