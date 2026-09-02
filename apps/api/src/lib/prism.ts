import type { PrismChatResponse } from "@mapvest/core";
import { UNDERLYING_URL, upstreamFetch } from "./underlying.js";

/**
 * Server-side client for the Prism (working name "ubermemo") memo engine that
 * lives in the sibling `underlying-analyzer-reboot` service.
 *
 * Mapvest owns no Prism math. This module is the whole boundary: it normalizes
 * tickers, forwards to the engine's `/api/prism*` surface through
 * `upstreamFetch` (so `UNDERLYING_URL` stays the single origin knob), and turns
 * upstream failures into one typed error the routes can map to a status.
 *
 * Upstream surface (see the engine's `app/prism/routes.py`):
 *   POST /api/prism                      { ticker, force?, include_memo? } → packet
 *   GET  /api/prism/<ticker>                                              → latest stored packet
 *   GET  /api/prism/<ticker>/summary                                      → bounded agent projection
 *   POST /api/prism/chat                 { ticker, message, history?, conversation_id? }
 *   GET  /api/prism/<ticker>/export?format=txt|json|pdf                   → bytes
 *
 * `/api/ubermemo*` is an alias of the same handlers upstream; Mapvest mounts
 * its own `/v1/ubermemo` alias rather than switching the upstream path.
 */

/** A cold build runs the full engine — macro, factors, HMM, filings, memo. */
export const PRISM_BUILD_TIMEOUT_MS = 180_000;
/** Reads hit stored packets. */
export const PRISM_READ_TIMEOUT_MS = 45_000;
/** Exports may re-render a PDF. */
export const PRISM_EXPORT_TIMEOUT_MS = 60_000;
/**
 * The research-agent context fetch is decoration, not a dependency: it gets one
 * short window and is dropped on any failure.
 */
export const PRISM_SUMMARY_TIMEOUT_MS = 3_000;
/** Upper bound on the packet summary injected into a research prompt. */
export const PRISM_SUMMARY_MAX_CHARS = 6_000;

/**
 * Prism symbols are not only equities: the engine reads crypto (`X:BTCUSD`) and
 * FX (`C:EURUSD`) pairs through the same path, so this is deliberately wider
 * than `isTicker()` in ./underlying.ts while still refusing anything that could
 * escape a path segment.
 */
const PRISM_SYMBOL = /^[A-Z][A-Z0-9.:-]{0,15}$/;

/** Uppercases and validates a caller-supplied symbol; `null` when unusable. */
export function normalizePrismTicker(raw: string | undefined | null): string | null {
  const value = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!value) return null;
  return PRISM_SYMBOL.test(value) ? value : null;
}

export const PRISM_EXPORT_FORMATS = ["txt", "json", "pdf"] as const;
export type PrismExportFormatName = (typeof PRISM_EXPORT_FORMATS)[number];

export function normalizePrismExportFormat(raw: string | undefined): PrismExportFormatName | null {
  const value = (raw ?? "txt").trim().toLowerCase();
  return (PRISM_EXPORT_FORMATS as readonly string[]).includes(value)
    ? (value as PrismExportFormatName)
    : null;
}

const EXPORT_CONTENT_TYPE: Record<PrismExportFormatName, string> = {
  txt: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  pdf: "application/pdf",
};

export function prismExportContentType(format: PrismExportFormatName): string {
  return EXPORT_CONTENT_TYPE[format];
}

/** `prism-NVDA.pdf` — filenames are built from the normalized ticker only. */
export function prismExportFilename(ticker: string, format: PrismExportFormatName): string {
  return `prism-${ticker.replace(/[^A-Z0-9.-]/g, "_")}.${format}`;
}

export class PrismUpstreamError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly retryAfter?: string;

  constructor(status: number, body: unknown, retryAfter?: string | null) {
    super(`Prism engine request failed (${status})`);
    this.name = "PrismUpstreamError";
    this.status = status;
    this.body = body;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}

function upstreamPath(suffix: string): string {
  return `/api/prism${suffix}`;
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

function networkError(error: unknown): PrismUpstreamError {
  // AbortError is our own timeout firing; everything else is a transport fault.
  const aborted =
    error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
  return new PrismUpstreamError(aborted ? 504 : 502, {
    error: aborted ? "prism engine timed out" : `prism engine unreachable: ${message(error)}`,
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Raw pass-through request; callers own the response body (used by export streaming). */
async function prismRequest(
  path: string,
  init: RequestInit & { timeoutMs: number },
): Promise<Response> {
  try {
    return await upstreamFetch(path, init);
  } catch (error) {
    throw networkError(error);
  }
}

async function prismJson(
  path: string,
  init: RequestInit & { timeoutMs: number },
): Promise<unknown> {
  const response = await prismRequest(path, init);
  const body = await readBody(response).catch(() => null);
  if (!response.ok) {
    throw new PrismUpstreamError(response.status, body, response.headers.get("retry-after"));
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

export type PrismBuildInput = Readonly<{
  ticker: string;
  force?: boolean;
  includeMemo?: boolean;
}>;

/**
 * `POST /api/prism` — builds (or returns today's stored) packet. Billable and
 * slow; the caller is expected to have passed the generation quota gate.
 */
export async function buildPrismPacket(input: PrismBuildInput): Promise<unknown> {
  return prismJson(
    upstreamPath(""),
    jsonInit(
      {
        ticker: input.ticker,
        ...(input.force === undefined ? {} : { force: input.force }),
        ...(input.includeMemo === undefined ? {} : { include_memo: input.includeMemo }),
      },
      PRISM_BUILD_TIMEOUT_MS,
    ),
  );
}

/** `GET /api/prism/{ticker}` — the latest stored packet; upstream 404s when none exists. */
export async function getPrismPacket(ticker: string): Promise<unknown> {
  return prismJson(upstreamPath(`/${encodeURIComponent(ticker)}`), {
    method: "GET",
    timeoutMs: PRISM_READ_TIMEOUT_MS,
  });
}

/** `GET /api/prism/{ticker}/summary` — the bounded agent projection. */
export async function getPrismSummary(
  ticker: string,
  timeoutMs: number = PRISM_READ_TIMEOUT_MS,
): Promise<unknown> {
  return prismJson(upstreamPath(`/${encodeURIComponent(ticker)}/summary`), {
    method: "GET",
    timeoutMs,
  });
}

export type PrismChatInput = Readonly<{
  ticker: string;
  message: string;
  conversationId?: string;
  history?: ReadonlyArray<{ role: "user" | "assistant"; content: string }>;
}>;

/** `POST /api/prism/chat` — one turn against the stored packet. */
export async function chatWithPrism(input: PrismChatInput): Promise<unknown> {
  return prismJson(
    upstreamPath("/chat"),
    jsonInit(
      {
        ticker: input.ticker,
        message: input.message,
        ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
        ...(input.history?.length ? { history: input.history } : {}),
      },
      PRISM_READ_TIMEOUT_MS,
    ),
  );
}

/**
 * `GET /api/prism/{ticker}/export` — returns the upstream `Response` unread so
 * the route can stream the body straight through without buffering a PDF.
 * A non-2xx is drained and raised, because an error body is small and the
 * route needs it to build a JSON failure.
 */
export async function exportPrismPacket(
  ticker: string,
  format: PrismExportFormatName,
): Promise<Response> {
  const response = await prismRequest(
    upstreamPath(`/${encodeURIComponent(ticker)}/export?format=${format}`),
    { method: "GET", timeoutMs: PRISM_EXPORT_TIMEOUT_MS, headers: { Accept: "*/*" } },
  );
  if (!response.ok) {
    const body = await readBody(response).catch(() => null);
    throw new PrismUpstreamError(response.status, body, response.headers.get("retry-after"));
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
 * Maps the engine's snake_case chat turn onto `PrismChatResponse`. Unknown keys
 * are preserved (the schema passes through) so a new engine field reaches the
 * client without a Mapvest release.
 */
export function normalizePrismChatResponse(raw: unknown, ticker: string): PrismChatResponse {
  const body = looseObject(raw) ?? {};
  const reply =
    text(body.reply) ?? text(body.message) ?? text(body.text) ?? text(body.answer) ?? "";
  const conversationId = text(body.conversationId) ?? text(body.conversation_id);
  const generatedAt = text(body.generatedAt) ?? text(body.generated_at);
  const citations = Array.isArray(body.citations)
    ? (body.citations as PrismChatResponse["citations"])
    : [];
  // Drop the snake_case originals we re-expose under camelCase; everything
  // else the engine sent survives the passthrough.
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
  } as PrismChatResponse;
}

/**
 * How long a rendered summary is reused. A packet is built at most once a day,
 * so five minutes is far inside its own staleness.
 */
export const PRISM_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;
/**
 * How long a *miss* is remembered. Short, because the interesting transition is
 * "the user just built this packet" — but long enough that a multi-turn
 * conversation about one unbuilt ticker does not pay a round trip per turn,
 * which is the overwhelmingly common case (most tickers have never been built).
 */
export const PRISM_SUMMARY_MISS_TTL_MS = 60 * 1000;

type SummaryCacheEntry = { value: string | undefined; expiresAt: number };
const summaryCache = new Map<string, SummaryCacheEntry>();

/** Test-only helper, mirroring `__resetRateLimit` in middleware/rateLimit.ts. */
export function __resetPrismSummaryCache(): void {
  summaryCache.clear();
}

/**
 * Best-effort packet context for a research turn.
 *
 * Contract with `routes/agent.ts`: this never throws, never retries, and is
 * bounded by {@link PRISM_SUMMARY_TIMEOUT_MS}. A missing packet simply yields
 * `undefined` and the research prompt is unchanged.
 *
 * Both outcomes are cached per normalized ticker — a hit for
 * {@link PRISM_SUMMARY_CACHE_TTL_MS}, a miss (404, timeout, unreachable
 * engine) for {@link PRISM_SUMMARY_MISS_TTL_MS}. Without the negative half,
 * every turn of a conversation about an unbuilt ticker pays a full round trip
 * to learn the same 404, and a slow engine stalls each turn for the whole 3s
 * before the prompt is even assembled.
 */
export async function prismSummaryForPrompt(
  ticker: string,
  timeoutMs: number = PRISM_SUMMARY_TIMEOUT_MS,
): Promise<string | undefined> {
  const symbol = normalizePrismTicker(ticker);
  if (!symbol) return undefined;

  const now = Date.now();
  const cached = summaryCache.get(symbol);
  if (cached && cached.expiresAt > now) return cached.value;

  let value: string | undefined;
  try {
    const raw = await getPrismSummary(symbol, timeoutMs);
    const rendered = renderPrismSummary(raw);
    value = rendered ? rendered.slice(0, PRISM_SUMMARY_MAX_CHARS) : undefined;
  } catch {
    value = undefined;
  }
  summaryCache.set(symbol, {
    value,
    expiresAt: Date.now() + (value ? PRISM_SUMMARY_CACHE_TTL_MS : PRISM_SUMMARY_MISS_TTL_MS),
  });
  return value;
}

function pct(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : undefined;
}

/** Prices, rounded — a prompt does not need `768.8912834692343`. */
function num(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.abs(value) >= 1 ? value.toFixed(2) : value.toPrecision(3);
}

/**
 * `bull 41%, neutral 38%, bear 21%` from the projection's case block, always
 * in that order — the engine hands back a plain object whose key order is
 * insertion order, and a prompt reads better bullish-to-bearish than in
 * whatever order the mixture happened to fill.
 */
const SCENARIO_CASE_ORDER = ["bull", "neutral", "bear"] as const;

function renderCases(cases: unknown): string | undefined {
  const body = looseObject(cases);
  if (!body) return undefined;
  const names = [
    ...SCENARIO_CASE_ORDER.filter((name) => name in body),
    ...Object.keys(body).filter(
      (name) => !(SCENARIO_CASE_ORDER as readonly string[]).includes(name),
    ),
  ];
  const parts: string[] = [];
  for (const name of names) {
    const probability = pct(looseObject(body[name])?.probability);
    if (probability) parts.push(`${name} ${probability}`);
  }
  return parts.length ? parts.join(", ") : undefined;
}

/**
 * Flattens a summary projection to prompt text; `undefined` when there is
 * nothing to say.
 *
 * The engine's projection (`app/prism/engine.py::prism_summary()`) has no
 * single `text` field — it is a nested object whose useful parts are the
 * recommendation, the scenario split, the entry band, the current regime, and
 * a memo excerpt. Serializing the whole thing as JSON would spend most of the
 * 6k-character budget on punctuation and on sections the research agent cannot
 * use, so this renders the headline facts as lines instead, and keeps the raw
 * JSON only as a last resort for a projection shaped differently than expected.
 * `text`/`summary`/`projection` still win when present, so an engine that
 * starts pre-rendering its own prose takes over from this function.
 */
export function renderPrismSummary(raw: unknown): string | undefined {
  if (typeof raw === "string") return text(raw);
  const body = looseObject(raw);
  if (!body) return undefined;
  const direct = text(body.text) ?? text(body.summary) ?? text(body.projection);
  if (direct) return direct;

  const lines: string[] = [];
  const ticker = text(body.ticker);
  const asOf = text(body.as_of);
  const label = [ticker, asOf ? `as of ${asOf}` : undefined].filter(Boolean).join(" ");
  if (label) lines.push(`Prism packet: ${label}`);

  const name = text(body.name);
  const descriptors = [text(body.sector), text(body.industry)].filter(Boolean).join(" / ");
  if (name) lines.push(`Company: ${name}${descriptors ? ` (${descriptors})` : ""}`);

  const recommendation = looseObject(body.recommendation);
  if (recommendation) {
    const action = text(recommendation.action) ?? "unknown";
    const strength = text(recommendation.strength);
    const conviction = pct(recommendation.conviction);
    lines.push(
      `Recommendation: ${action}${strength ? ` (${strength})` : ""}${
        conviction ? `, conviction ${conviction}` : ""
      }`,
    );
  }
  const oneLine = text(body.one_line) ?? text(looseObject(body.recommendation)?.one_line);
  if (oneLine) lines.push(`Thesis: ${oneLine}`);

  const scenarios = looseObject(body.scenarios);
  const cases = renderCases(scenarios?.cases);
  if (cases) {
    const horizon = text(scenarios?.probability_horizon);
    lines.push(`Scenarios${horizon ? ` (${horizon})` : ""}: ${cases}`);
  }
  const entry = looseObject(scenarios?.entry);
  if (entry) {
    const band = [
      num(entry.bargain_below) ? `bargain below ${num(entry.bargain_below)}` : undefined,
      num(entry.fair_value) ? `fair ${num(entry.fair_value)}` : undefined,
      num(entry.expensive_above) ? `expensive above ${num(entry.expensive_above)}` : undefined,
      num(entry.current_price) ? `now ${num(entry.current_price)}` : undefined,
    ].filter(Boolean);
    if (band.length) lines.push(`Entry zone: ${band.join(", ")}`);
  }
  const timing = looseObject(scenarios?.timing);
  const timingLabel = text(timing?.this_month);
  if (timingLabel) {
    const reason = text(timing?.reason);
    lines.push(`Timing this month: ${timingLabel}${reason ? ` — ${reason}` : ""}`);
  }

  const regime = looseObject(body.regime);
  const regimeLabel = text(regime?.label);
  if (regimeLabel) {
    const days = regime?.days_in_regime;
    const held = typeof days === "number" && Number.isFinite(days) ? Math.round(days) : null;
    lines.push(`Regime: ${regimeLabel}${held === null ? "" : ` (${held} days in)`}`);
  }
  const entropy = looseObject(body.entropy_3m);
  const entropyClass = text(entropy?.classification);
  if (entropyClass) lines.push(`3m entropy: ${entropyClass}`);

  const excerpt = text(body.memo_excerpt);
  if (excerpt) lines.push(`Memo excerpt: ${excerpt}`);

  const unavailable = Array.isArray(body.unavailable_sections)
    ? body.unavailable_sections.filter((v): v is string => typeof v === "string")
    : [];
  if (unavailable.length) lines.push(`Sections unavailable: ${unavailable.join(", ")}`);

  // Only two lines means we recognised the ticker header and nothing else —
  // the projection is shaped differently than expected, so fall back to JSON
  // rather than injecting a near-empty context block.
  if (lines.length > 2) return lines.join("\n");

  try {
    const serialized = JSON.stringify(body);
    return serialized && serialized !== "{}" ? serialized : undefined;
  } catch {
    return undefined;
  }
}

export { UNDERLYING_URL as PRISM_UPSTREAM_URL };
