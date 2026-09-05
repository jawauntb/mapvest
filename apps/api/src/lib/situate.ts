import type { SituateChatResponse } from "@mapvest/core";
import { UNDERLYING_URL, upstreamFetch } from "./underlying.js";

/**
 * Server-side client for the Situate research engine — the single-name engine
 * that reforms Prism — which lives in the sibling `underlying-analyzer-reboot`
 * service.
 *
 * Mapvest owns no Situate math. This module is the whole boundary: it
 * normalizes tickers, forwards to the engine's `/api/situate*` surface through
 * `upstreamFetch` (so `UNDERLYING_URL` stays the single origin knob), and turns
 * upstream failures into one typed error the routes can map to a status. It is
 * a byte-for-byte sibling of {@link file://./prism.ts} on purpose — the two
 * engines share the same proxy contract.
 *
 * Upstream surface (see the engine's `app/situate/routes.py`):
 *   POST /api/situate                      { ticker, force?, include_memo?, as_of? } → packet
 *   GET  /api/situate/<ticker>                                                       → latest stored packet
 *   GET  /api/situate/<ticker>/summary                                               → bounded agent projection
 *   POST /api/situate/<ticker>/chat        { message, history?, conversation_id? }   → one turn
 *   GET  /api/situate/<ticker>/export?format=md|json|pdf                             → bytes
 *
 * `/api/research*` is an alias of the same handlers upstream; Mapvest mounts
 * its own `/v1/research` alias rather than switching the upstream path.
 */

/** A cold build runs the full engine — panels, exposure, base rates, implied, filings, memo. */
export const SITUATE_BUILD_TIMEOUT_MS = 180_000;
/** Reads hit stored packets. */
export const SITUATE_READ_TIMEOUT_MS = 45_000;
/** Exports may re-render a PDF. */
export const SITUATE_EXPORT_TIMEOUT_MS = 60_000;
/**
 * The research-agent context fetch is decoration, not a dependency: it gets one
 * short window and is dropped on any failure.
 */
export const SITUATE_SUMMARY_TIMEOUT_MS = 3_000;
/** Upper bound on the packet summary injected into a research prompt. */
export const SITUATE_SUMMARY_MAX_CHARS = 6_000;

/**
 * Situate symbols are not only equities: the engine reads crypto (`X:BTCUSD`)
 * and FX (`C:EURUSD`) pairs through the same path, so this is deliberately
 * wider than `isTicker()` in ./underlying.ts while still refusing anything that
 * could escape a path segment.
 */
const SITUATE_SYMBOL = /^[A-Z][A-Z0-9.:-]{0,15}$/;

/** Uppercases and validates a caller-supplied symbol; `null` when unusable. */
export function normalizeSituateTicker(raw: string | undefined | null): string | null {
  const value = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!value) return null;
  return SITUATE_SYMBOL.test(value) ? value : null;
}

export const SITUATE_EXPORT_FORMATS = ["txt", "json", "pdf"] as const;
export type SituateExportFormatName = (typeof SITUATE_EXPORT_FORMATS)[number];

export function normalizeSituateExportFormat(
  raw: string | undefined,
): SituateExportFormatName | null {
  const value = (raw ?? "txt").trim().toLowerCase();
  return (SITUATE_EXPORT_FORMATS as readonly string[]).includes(value)
    ? (value as SituateExportFormatName)
    : null;
}

const EXPORT_CONTENT_TYPE: Record<SituateExportFormatName, string> = {
  txt: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  pdf: "application/pdf",
};

export function situateExportContentType(format: SituateExportFormatName): string {
  return EXPORT_CONTENT_TYPE[format];
}

/** `situate-NVDA.pdf` — filenames are built from the normalized ticker only. */
export function situateExportFilename(ticker: string, format: SituateExportFormatName): string {
  return `situate-${ticker.replace(/[^A-Z0-9.-]/g, "_")}.${format}`;
}

export class SituateUpstreamError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly retryAfter?: string;

  constructor(status: number, body: unknown, retryAfter?: string | null) {
    super(`Situate engine request failed (${status})`);
    this.name = "SituateUpstreamError";
    this.status = status;
    this.body = body;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}

function upstreamPath(suffix: string): string {
  return `/api/situate${suffix}`;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function networkError(error: unknown): SituateUpstreamError {
  // AbortError is our own timeout firing; everything else is a transport fault.
  const aborted =
    error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
  return new SituateUpstreamError(aborted ? 504 : 502, {
    error: aborted ? "situate engine timed out" : `situate engine unreachable: ${message(error)}`,
  });
}

/** Raw pass-through request; callers own the response body (used by export streaming). */
async function situateRequest(
  path: string,
  init: RequestInit & { timeoutMs: number },
): Promise<Response> {
  try {
    return await upstreamFetch(path, init);
  } catch (error) {
    throw networkError(error);
  }
}

async function situateJson(
  path: string,
  init: RequestInit & { timeoutMs: number },
): Promise<unknown> {
  const response = await situateRequest(path, init);
  const body = await readBody(response).catch(() => null);
  if (!response.ok) {
    throw new SituateUpstreamError(response.status, body, response.headers.get("retry-after"));
  }
  return body;
}

function jsonInit(body: unknown, timeoutMs: number): RequestInit & { timeoutMs: number } {
  return {
    method: "POST",
    timeoutMs,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export type SituateBuildInput = Readonly<{
  ticker: string;
  force?: boolean;
  includeMemo?: boolean;
  asOf?: string;
}>;

/**
 * `POST /api/situate` — builds (or returns today's stored) packet. Billable and
 * slow; the caller is expected to have passed the generation quota gate.
 */
export async function buildSituatePacket(input: SituateBuildInput): Promise<unknown> {
  return situateJson(
    upstreamPath(""),
    jsonInit(
      {
        ticker: input.ticker,
        ...(input.force === undefined ? {} : { force: input.force }),
        ...(input.includeMemo === undefined ? {} : { include_memo: input.includeMemo }),
        ...(input.asOf === undefined ? {} : { as_of: input.asOf }),
      },
      SITUATE_BUILD_TIMEOUT_MS,
    ),
  );
}

/** `GET /api/situate/{ticker}` — the latest stored packet; upstream 404s when none exists. */
export async function getSituatePacket(ticker: string): Promise<unknown> {
  return situateJson(upstreamPath(`/${encodeURIComponent(ticker)}`), {
    method: "GET",
    timeoutMs: SITUATE_READ_TIMEOUT_MS,
  });
}

/** `GET /api/situate/{ticker}/summary` — the bounded agent projection. */
export async function getSituateSummary(
  ticker: string,
  timeoutMs: number = SITUATE_READ_TIMEOUT_MS,
): Promise<unknown> {
  return situateJson(upstreamPath(`/${encodeURIComponent(ticker)}/summary`), {
    method: "GET",
    timeoutMs,
  });
}

export type SituateChatInput = Readonly<{
  ticker: string;
  message: string;
  conversationId?: string;
  history?: ReadonlyArray<{ role: "user" | "assistant"; content: string }>;
}>;

/** `POST /api/situate/{ticker}/chat` — one turn against the stored packet. */
export async function chatWithSituate(input: SituateChatInput): Promise<unknown> {
  return situateJson(
    upstreamPath(`/${encodeURIComponent(input.ticker)}/chat`),
    jsonInit(
      {
        ticker: input.ticker,
        message: input.message,
        ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
        ...(input.history?.length ? { history: input.history } : {}),
      },
      SITUATE_READ_TIMEOUT_MS,
    ),
  );
}

/**
 * `GET /api/situate/{ticker}/export` — returns the upstream `Response` unread so
 * the route can stream the body straight through without buffering a PDF.
 * A non-2xx is drained and raised, because an error body is small and the
 * route needs it to build a JSON failure.
 */
export async function exportSituatePacket(
  ticker: string,
  format: SituateExportFormatName,
): Promise<Response> {
  // The client-facing `txt` format maps to the engine's Markdown export, which
  // is its plain-text form; the route keeps the txt content-type/filename toward
  // the client. The engine only accepts md|json|pdf and 400s anything else.
  const upstreamFormat = format === "txt" ? "md" : format;
  const response = await situateRequest(
    upstreamPath(`/${encodeURIComponent(ticker)}/export?format=${upstreamFormat}`),
    { method: "GET", timeoutMs: SITUATE_EXPORT_TIMEOUT_MS, headers: { Accept: "*/*" } },
  );
  if (!response.ok) {
    const body = await readBody(response).catch(() => null);
    throw new SituateUpstreamError(response.status, body, response.headers.get("retry-after"));
  }
  return response;
}

function looseObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Maps the engine's snake_case chat turn onto `SituateChatResponse`. Unknown
 * keys are preserved (the schema passes through) so a new engine field reaches
 * the client without a Mapvest release.
 */
export function normalizeSituateChatResponse(raw: unknown, ticker: string): SituateChatResponse {
  const body = looseObject(raw) ?? {};
  const reply =
    text(body.reply) ?? text(body.message) ?? text(body.text) ?? text(body.answer) ?? "";
  const conversationId = text(body.conversationId) ?? text(body.conversation_id);
  const generatedAt = text(body.generatedAt) ?? text(body.generated_at);
  const citations = Array.isArray(body.citations)
    ? (body.citations as SituateChatResponse["citations"])
    : [];
  const rest: Record<string, unknown> = { ...body };
  for (const key of ["conversation_id", "generated_at"]) delete rest[key];
  return {
    ...rest,
    ticker: text(body.ticker) ?? ticker,
    reply,
    citations,
    ...(conversationId ? { conversationId } : {}),
    ...(text(body.model) ? { model: text(body.model) } : {}),
    ...(generatedAt ? { generatedAt } : {}),
  } as SituateChatResponse;
}

/**
 * How long a rendered summary is reused. A packet is built at most once a day,
 * so five minutes is far inside its own staleness.
 */
export const SITUATE_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;
/** How long a *miss* is remembered — see the note on the Prism sibling. */
export const SITUATE_SUMMARY_MISS_TTL_MS = 60 * 1000;

type SummaryCacheEntry = { value: string | undefined; expiresAt: number };
const summaryCache = new Map<string, SummaryCacheEntry>();
/** Only sweep expired summary entries once the Map is non-trivially large. */
const SUMMARY_CACHE_SWEEP_AT = 256;

/** Test-only helper, mirroring `__resetRateLimit` in middleware/rateLimit.ts. */
export function __resetSituateSummaryCache(): void {
  summaryCache.clear();
}

/**
 * Best-effort packet context for a research turn.
 *
 * Contract with `routes/agent.ts`: this never throws, never retries, and is
 * bounded by {@link SITUATE_SUMMARY_TIMEOUT_MS}. A missing packet yields
 * `undefined` and the research prompt is unchanged. Both outcomes are cached
 * per normalized ticker — a hit for {@link SITUATE_SUMMARY_CACHE_TTL_MS}, a
 * miss for {@link SITUATE_SUMMARY_MISS_TTL_MS}.
 */
export async function situateSummaryForPrompt(
  ticker: string,
  timeoutMs: number = SITUATE_SUMMARY_TIMEOUT_MS,
): Promise<string | undefined> {
  const symbol = normalizeSituateTicker(ticker);
  if (!symbol) return undefined;

  const now = Date.now();
  const cached = summaryCache.get(symbol);
  if (cached && cached.expiresAt > now) return cached.value;

  let value: string | undefined;
  try {
    const raw = await getSituateSummary(symbol, timeoutMs);
    const rendered = renderSituateSummary(raw);
    value = rendered ? rendered.slice(0, SITUATE_SUMMARY_MAX_CHARS) : undefined;
  } catch {
    value = undefined;
  }
  // Prune expired entries before growing the Map, so a churn of distinct
  // tickers can't accumulate dead entries unbounded (TTL-on-read alone never
  // sweeps a ticker that is looked up once and never again).
  const writeNow = Date.now();
  if (summaryCache.size >= SUMMARY_CACHE_SWEEP_AT) {
    for (const [key, entry] of summaryCache) {
      if (entry.expiresAt <= writeNow) summaryCache.delete(key);
    }
  }
  summaryCache.set(symbol, {
    value,
    expiresAt: writeNow + (value ? SITUATE_SUMMARY_CACHE_TTL_MS : SITUATE_SUMMARY_MISS_TTL_MS),
  });
  return value;
}

function pct(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : undefined;
}

const STANCE_LABEL: Record<string, string> = {
  odds_favorable: "odds favorable",
  balanced: "balanced",
  odds_unfavorable: "odds unfavorable",
};

/**
 * Flattens a summary projection to prompt text; `undefined` when there is
 * nothing to say.
 *
 * The engine's projection has no single `text` field — it is a nested object
 * whose useful parts are the posture (stance / horizon / conviction), the
 * one-line thesis, and a memo excerpt. `text`/`summary`/`projection` still win
 * when present, so an engine that starts pre-rendering prose takes over.
 */
export function renderSituateSummary(raw: unknown): string | undefined {
  if (typeof raw === "string") return text(raw);
  const body = looseObject(raw);
  if (!body) return undefined;
  const direct = text(body.text) ?? text(body.summary) ?? text(body.projection);
  if (direct) return direct;

  const lines: string[] = [];
  const ticker = text(body.ticker);
  const asOf = text(body.as_of);
  const label = [ticker, asOf ? `as of ${asOf}` : undefined].filter(Boolean).join(" ");
  if (label) lines.push(`Situate packet: ${label}`);

  const name = text(body.name);
  const descriptors = [text(body.sector), text(body.industry)].filter(Boolean).join(" / ");
  if (name) lines.push(`Company: ${name}${descriptors ? ` (${descriptors})` : ""}`);

  const posture = looseObject(body.posture);
  if (posture) {
    const stance = text(posture.stance);
    const stanceLabel = stance ? (STANCE_LABEL[stance] ?? stance) : "unknown";
    const horizon = text(posture.horizon);
    const conviction = pct(posture.conviction);
    lines.push(
      `Posture: ${stanceLabel}${horizon ? ` at ${horizon}` : ""}${
        conviction ? `, conviction ${conviction}` : ""
      }`,
    );
    const oneLine = text(posture.one_line) ?? text(body.one_line);
    if (oneLine) lines.push(`Thesis: ${oneLine}`);
  } else {
    const oneLine = text(body.one_line);
    if (oneLine) lines.push(`Thesis: ${oneLine}`);
  }

  const excerpt = text(body.memo_excerpt);
  if (excerpt) lines.push(`Memo excerpt: ${excerpt}`);

  const unavailable = Array.isArray(body.unavailable_sections)
    ? body.unavailable_sections.filter((v): v is string => typeof v === "string")
    : [];
  if (unavailable.length) lines.push(`Sections unavailable: ${unavailable.join(", ")}`);

  // Only the header line means the projection is shaped differently than
  // expected — fall back to raw JSON rather than injecting a near-empty block.
  if (lines.length > 1) return lines.join("\n");

  try {
    const serialized = JSON.stringify(body);
    return serialized && serialized !== "{}" ? serialized : undefined;
  } catch {
    return undefined;
  }
}

export { UNDERLYING_URL as SITUATE_UPSTREAM_URL };
