import { SituateBuildRequest, SituateChatRequest } from "@mapvest/core";
import { type Context, Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import {
  SITUATE_UPSTREAM_URL,
  SituateUpstreamError,
  buildSituatePacket,
  chatWithSituate,
  exportSituatePacket,
  getSituatePacket,
  getSituateSummary,
  normalizeSituateChatResponse,
  normalizeSituateExportFormat,
  normalizeSituateTicker,
  situateExportContentType,
  situateExportFilename,
} from "../lib/situate.js";
import { optionalAuth } from "../middleware/optionalAuth.js";
import {
  deviceIdFromRequest,
  requireGenerationQuota,
} from "../middleware/requireGenerationQuota.js";

/**
 * Situate — the single-name research engine that reforms Prism, proxied.
 *
 * Mounted twice in `index.ts`: at `/v1/situate` and at the alias `/v1/research`.
 * Both hit the same handlers, exactly as the engine aliases `/api/situate` and
 * `/api/research`.
 *
 * These are thin proxies (AGENTS.md §3: "no business logic beyond glue"). The
 * packet is passed through verbatim — Mapvest does not re-validate the engine's
 * analytical sections, because a strict gate here would turn an engine schema
 * addition into a 502 for every client. The zod contract in `packages/core`
 * (`SituatePacket`) is what clients parse against, and its analytical sections
 * are passthrough for the same reason.
 *
 * Metering: `POST /v1/situate` is the one route that runs the whole engine plus
 * an Anthropic memo, so it carries `requireGenerationQuota("memo")` — the same
 * meter kind as Prism and `POST /v1/memo`, since to a user they are one memo
 * generation. It is metered idempotently (see {@link situateBuildQuota})
 * because the engine short-circuits a repeat non-forced build and spends
 * nothing. Reads, the summary projection, and exports are free. Chat is capped
 * per identity because it spends one upstream completion per turn.
 */
const situate = new Hono();

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
 * busy). Every other upstream code collapses to 502.
 */
function mapError(error: unknown): MappedError {
  if (error instanceof SituateUpstreamError) {
    const detail = upstreamDetail(error.body);
    if (error.status === 404) {
      return {
        status: 404,
        body: {
          error: detail ?? "no Situate packet for this ticker yet — POST /v1/situate to build one",
          code: "situate_packet_not_found",
        },
      };
    }
    if (error.status === 400) {
      return {
        status: 400,
        body: {
          error: detail ?? "Situate engine rejected the request",
          code: "situate_bad_request",
        },
      };
    }
    if (error.status === 429 || error.status === 503) {
      return {
        status: error.status,
        body: {
          error: detail ?? "Situate engine is busy; retry shortly",
          code: "situate_busy",
          upstreamStatus: error.status,
        },
        ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
      };
    }
    if (error.status === 504) {
      return {
        status: 504,
        body: { error: detail ?? "Situate engine timed out", code: "situate_timeout" },
      };
    }
    return {
      status: 502,
      body: {
        error: "Situate engine is unavailable",
        code: "situate_upstream_failed",
        upstreamStatus: error.status,
      },
    };
  }
  return {
    status: 502,
    body: {
      error: error instanceof Error ? error.message : "Situate request failed",
      code: "situate_request_failed",
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
 * The engine returns today's already-built packet for a non-forced build (from
 * the store, no provider calls, no Anthropic call, no cost). Metering that
 * would let a client burn its whole free tier on cache hits — and both the iOS
 * screen and the documented poll-around-a-long-build flow re-POST the same
 * ticker. So a non-forced build is keyed by `situate:{ticker}:{utc day}` and
 * charged at most once per ticker per day. A forced rebuild gets no key: it
 * really does re-run the engine, so every one is a generation. A pinned `asOf`
 * varies the key so a historical build is metered separately from today's.
 */
export const situateBuildQuota = requireGenerationQuota("memo", async (c) => {
  const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (raw?.force === true) return undefined;
  const ticker = normalizeSituateTicker(typeof raw?.ticker === "string" ? raw.ticker : null);
  if (!ticker) return undefined;
  const asOf =
    typeof raw?.asOf === "string" ? raw.asOf : typeof raw?.as_of === "string" ? raw.as_of : null;
  return `situate:${ticker}:${asOf ?? buildDay()}`;
});

/**
 * POST /v1/situate  { ticker, force?, includeMemo?, asOf? } → SituatePacket
 *
 * Billable. A cold build runs the whole engine and can take 1–3 minutes, hence
 * the 180s upstream budget in lib/situate.ts; clients should render staged
 * progress and may fall back to polling `GET /v1/situate/:ticker`.
 */
situate.post("/", optionalAuth, situateBuildQuota, async (c) => {
  return safeExecuteWithSpan("http.situate.build", async (span) => {
    const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    // Accept the engine's snake_case spelling too, so a caller holding the
    // upstream contract does not silently lose a flag.
    const parsed = SituateBuildRequest.safeParse({
      ticker: raw?.ticker,
      ...(raw?.force === undefined ? {} : { force: raw.force }),
      ...(raw?.includeMemo === undefined && raw?.include_memo === undefined
        ? {}
        : { includeMemo: raw?.includeMemo ?? raw?.include_memo }),
      ...(raw?.asOf === undefined && raw?.as_of === undefined
        ? {}
        : { asOf: raw?.asOf ?? raw?.as_of }),
    });
    if (!parsed.success) {
      span.setAttribute("error.kind", "invalid_request");
      return c.json({ error: "ticker required", code: "situate_bad_request" }, 400);
    }
    const ticker = normalizeSituateTicker(parsed.data.ticker);
    if (!ticker) {
      span.setAttribute("error.kind", "invalid_ticker");
      return c.json({ error: "invalid ticker", code: "situate_bad_request" }, 400);
    }
    span.setAttributes({
      ticker,
      force: Boolean(parsed.data.force),
      include_memo: parsed.data.includeMemo !== false,
    });

    const started = performance.now();
    try {
      const packet = await buildSituatePacket({
        ticker,
        ...(parsed.data.force === undefined ? {} : { force: parsed.data.force }),
        ...(parsed.data.includeMemo === undefined ? {} : { includeMemo: parsed.data.includeMemo }),
        ...(parsed.data.asOf === undefined ? {} : { asOf: parsed.data.asOf }),
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
 * A chat turn produces no new analysis, but it is not free: upstream it sends
 * the packet projection plus the memo to Anthropic on the same key
 * `POST /v1/situate` is metered for. Left ungated, an anonymous caller could
 * spend that in a loop. It is deliberately not the generation meter — that
 * would make the packet unquestionable — but a per-identity window, generous
 * for a person reading one memo and useless for a script. Mirrors Prism.
 */
export const SITUATE_CHAT_LIMIT = 30;
export const SITUATE_CHAT_WINDOW_MS = 60 * 60 * 1000;

type ChatBucket = { count: number; resetAt: number };
const chatBuckets = new Map<string, ChatBucket>();
/** Only sweep once the Map is non-trivially large — the common case pays nothing. */
const CHAT_BUCKET_SWEEP_AT = 256;

/** Test-only helper, mirroring `__resetRateLimit` in middleware/rateLimit.ts. */
export function __resetSituateChatLimit(): void {
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
    // Opportunistic eviction: a fresh/expired identity is the only moment we
    // touch the Map, so sweep every stale window then. Without this the Map
    // grows one permanent entry per distinct anonymous device id.
    if (chatBuckets.size >= CHAT_BUCKET_SWEEP_AT) {
      for (const [key, b] of chatBuckets) {
        if (b.resetAt <= now) chatBuckets.delete(key);
      }
    }
    chatBuckets.set(identity, { count: 1, resetAt: now + SITUATE_CHAT_WINDOW_MS });
    return null;
  }
  bucket.count += 1;
  if (bucket.count > SITUATE_CHAT_LIMIT) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  }
  return null;
}

/**
 * POST /v1/situate/chat  { ticker, message, conversationId?, history? }
 *   → SituateChatResponse
 *
 * Answers strictly from the stored packet, so it 404s when nothing has been
 * built for the ticker. It does not spend a generation, but it *does* spend one
 * Anthropic completion upstream per turn, so it requires an identity and is
 * capped at {@link SITUATE_CHAT_LIMIT} turns per identity per hour.
 */
situate.post("/chat", optionalAuth, async (c) => {
  return safeExecuteWithSpan("http.situate.chat", async (span) => {
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
          error: `too many Situate chat turns; retry in ${retryAfter}s`,
          code: "situate_chat_rate_limited",
          limit: SITUATE_CHAT_LIMIT,
          retryAfter,
        },
        429,
      );
    }

    const raw = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const parsed = SituateChatRequest.safeParse({
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
        { error: "ticker and message (1–4000 chars) required", code: "situate_bad_request" },
        400,
      );
    }
    const ticker = normalizeSituateTicker(parsed.data.ticker);
    if (!ticker) {
      span.setAttribute("error.kind", "invalid_ticker");
      return c.json({ error: "invalid ticker", code: "situate_bad_request" }, 400);
    }
    span.setAttributes({ ticker, has_history: Boolean(parsed.data.history?.length) });

    try {
      const reply = await chatWithSituate({
        ticker,
        message: parsed.data.message,
        ...(parsed.data.conversationId ? { conversationId: parsed.data.conversationId } : {}),
        ...(parsed.data.history ? { history: parsed.data.history } : {}),
      });
      return c.json(normalizeSituateChatResponse(reply, ticker));
    } catch (error) {
      span.setAttribute("error_kind", "upstream");
      return fail(c, error);
    }
  });
});

/**
 * GET /v1/situate/:ticker/summary → the bounded agent projection of the packet.
 * This is what `routes/agent.ts` injects into a research prompt, and what a
 * lightweight client can render without pulling the whole packet.
 */
situate.get("/:ticker/summary", async (c) => {
  return safeExecuteWithSpan("http.situate.summary", async (span) => {
    const ticker = normalizeSituateTicker(c.req.param("ticker"));
    if (!ticker) {
      span.setAttribute("error.kind", "invalid_ticker");
      return c.json({ error: "invalid ticker", code: "situate_bad_request" }, 400);
    }
    span.setAttribute("ticker", ticker);
    try {
      const summary = await getSituateSummary(ticker);
      return c.json(summary as Record<string, unknown>);
    } catch (error) {
      span.setAttribute("error_kind", "upstream");
      return fail(c, error);
    }
  });
});

/**
 * GET /v1/situate/:ticker/export?format=txt|json|pdf
 *
 * Streams the engine's bytes through unbuffered with an explicit content type
 * and a `Content-Disposition` attachment name, so `expo-file-system` on iOS can
 * download straight to a share sheet. `private, no-store` because a packet is a
 * per-caller research artifact, not a cacheable public document.
 */
situate.get("/:ticker/export", async (c) => {
  return safeExecuteWithSpan("http.situate.export", async (span) => {
    const ticker = normalizeSituateTicker(c.req.param("ticker"));
    if (!ticker) {
      span.setAttribute("error.kind", "invalid_ticker");
      return c.json({ error: "invalid ticker", code: "situate_bad_request" }, 400);
    }
    const format = normalizeSituateExportFormat(c.req.query("format"));
    if (!format) {
      span.setAttribute("error.kind", "invalid_format");
      return c.json(
        { error: "format must be one of txt, json, pdf", code: "situate_bad_request" },
        400,
      );
    }
    span.setAttributes({ ticker, format });

    try {
      const upstream = await exportSituatePacket(ticker, format);
      const headers = new Headers({
        "Content-Type": upstream.headers.get("content-type") ?? situateExportContentType(format),
        "Content-Disposition":
          upstream.headers.get("content-disposition") ??
          `attachment; filename="${situateExportFilename(ticker, format)}"`,
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
 * GET /v1/situate/:ticker → the latest stored packet, or 404 when none exists.
 * Free and identity-less: reading a packet spends no provider money. Clients
 * poll this while `POST /v1/situate` is running.
 */
situate.get("/:ticker", async (c) => {
  return safeExecuteWithSpan("http.situate.get", async (span) => {
    const ticker = normalizeSituateTicker(c.req.param("ticker"));
    if (!ticker) {
      span.setAttribute("error.kind", "invalid_ticker");
      return c.json({ error: "invalid ticker", code: "situate_bad_request" }, 400);
    }
    span.setAttribute("ticker", ticker);
    try {
      const packet = await getSituatePacket(ticker);
      return c.json(packet as Record<string, unknown>);
    } catch (error) {
      span.setAttribute("error_kind", "upstream");
      return fail(c, error);
    }
  });
});

/** GET /v1/situate → what this surface is and where the engine lives. */
situate.get("/", (c) =>
  c.json({
    name: "Situate",
    alias: "research",
    engine: SITUATE_UPSTREAM_URL,
    note: "POST /v1/situate { ticker } to build a packet; GET /v1/situate/{ticker} to read the latest.",
    routes: [
      "POST /v1/situate",
      "GET /v1/situate/{ticker}",
      "GET /v1/situate/{ticker}/summary",
      "POST /v1/situate/chat",
      "GET /v1/situate/{ticker}/export?format=txt|json|pdf",
    ],
    disclaimer:
      "Research only. Not investment advice. Posture, not buy/sell; no point price targets.",
  }),
);

export default situate;
