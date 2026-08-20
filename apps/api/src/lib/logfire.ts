/**
 * Pydantic-Logfire-style observability for apps/api.
 *
 * We do not depend on the `logfire` npm SDK — its zod@^4 peer conflicts with
 * our zod@^3 workspace, and Bun's HTTP stack does not need the SDK's exporter
 * to emit spans. Instead we emit newline-delimited JSON on stdout in an
 * OpenTelemetry-friendly shape: Logfire's OTel HTTP ingest (or any OTel
 * collector) can pick these up when LOGFIRE_TOKEN is wired at the platform
 * level (Railway → Doppler → env).
 *
 * When LOGFIRE_TOKEN is set we ALSO POST each finished span to the Logfire
 * OTLP/HTTP endpoint on a best-effort basis (non-blocking, silent failures)
 * so the app self-exports without a sidecar collector.
 *
 * Exports:
 *   - startSpan(name, attrs)              → Span  (call .end() when done)
 *   - recordCounter(name, value, attrs)   → void  (single-shot metric)
 *   - safeExecuteWithSpan(name, fn, attrs)→ Promise<T>  (fn(span) never throws
 *     the process; span carries error attrs + status on failure and rethrows)
 */

const SERVICE_NAME = process.env.LOGFIRE_SERVICE_NAME ?? "mapvest-api";
const LOGFIRE_TOKEN = process.env.LOGFIRE_TOKEN;
const LOGFIRE_ENDPOINT =
  process.env.LOGFIRE_ENDPOINT ?? "https://logfire-api.pydantic.dev/v1/traces";

export type SpanAttrs = Record<string, unknown>;

export type SpanStatus = "ok" | "error";

export interface Span {
  /** Merge additional attributes onto the span before it ends. */
  setAttribute(key: string, value: unknown): Span;
  setAttributes(attrs: SpanAttrs): Span;
  /** Attach an exception; also flips status to "error" unless already set. */
  recordException(err: unknown): Span;
  /** Emit + finalize. Idempotent: a second call is a no-op. */
  end(status?: SpanStatus): void;
  /** Read-only accessor used by helpers/tests. */
  readonly name: string;
}

function nowNs(): bigint {
  // High-precision epoch nanoseconds. performance.timeOrigin is ms since epoch.
  return (
    BigInt(Math.floor(performance.timeOrigin * 1e6)) + BigInt(Math.floor(performance.now() * 1e6))
  );
}

function randHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let out = "";
  for (const b of arr) out += b.toString(16).padStart(2, "0");
  return out;
}

function stringifySafe(v: unknown): unknown {
  if (v instanceof Error) {
    return { name: v.name, message: v.message, stack: v.stack };
  }
  return v;
}

function normalizeAttrs(attrs?: SpanAttrs): SpanAttrs {
  if (!attrs) return {};
  const out: SpanAttrs = {};
  for (const [k, v] of Object.entries(attrs)) out[k] = stringifySafe(v);
  return out;
}

async function exportToLogfire(payload: Record<string, unknown>): Promise<void> {
  if (!LOGFIRE_TOKEN) return;
  try {
    await fetch(LOGFIRE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOGFIRE_TOKEN}`,
      },
      body: JSON.stringify(payload),
      // Fire-and-forget — never let observability block a request.
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // silent — observability must not affect the hot path
  }
}

function emit(payload: Record<string, unknown>): void {
  // Newline-delimited JSON on stdout — parseable by any log-shipper / OTel collector.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
  // Best-effort direct export.
  void exportToLogfire(payload);
}

class SpanImpl implements Span {
  readonly name: string;
  private readonly traceId: string;
  private readonly spanId: string;
  private readonly startNs: bigint;
  private readonly startPerf: number;
  private attrs: SpanAttrs;
  private status: SpanStatus | null = null;
  private ended = false;
  private exceptions: SpanAttrs[] = [];

  constructor(name: string, attrs?: SpanAttrs) {
    this.name = name;
    this.traceId = randHex(16);
    this.spanId = randHex(8);
    this.startNs = nowNs();
    this.startPerf = performance.now();
    this.attrs = normalizeAttrs(attrs);
  }

  setAttribute(key: string, value: unknown): Span {
    this.attrs[key] = stringifySafe(value);
    return this;
  }

  setAttributes(attrs: SpanAttrs): Span {
    for (const [k, v] of Object.entries(attrs)) this.attrs[k] = stringifySafe(v);
    return this;
  }

  recordException(err: unknown): Span {
    const e =
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { name: "NonError", message: String(err) };
    this.exceptions.push(e);
    if (!this.status) this.status = "error";
    return this;
  }

  end(status?: SpanStatus): void {
    if (this.ended) return;
    this.ended = true;
    const latencyMs = Math.round((performance.now() - this.startPerf) * 1000) / 1000;
    const finalStatus = status ?? this.status ?? "ok";
    emit({
      kind: "span",
      service: SERVICE_NAME,
      name: this.name,
      trace_id: this.traceId,
      span_id: this.spanId,
      start_time_unix_nano: this.startNs.toString(),
      end_time_unix_nano: (this.startNs + BigInt(Math.floor(latencyMs * 1e6))).toString(),
      latency_ms: latencyMs,
      status: finalStatus,
      attributes: { ...this.attrs, latency_ms: latencyMs },
      events: this.exceptions.map((e) => ({
        name: "exception",
        attributes: e,
      })),
    });
  }
}

export function startSpan(name: string, attrs?: SpanAttrs): Span {
  return new SpanImpl(name, attrs);
}

export function recordCounter(name: string, value: number, attrs?: SpanAttrs): void {
  emit({
    kind: "metric",
    metric_type: "counter",
    service: SERVICE_NAME,
    name,
    value,
    time_unix_nano: nowNs().toString(),
    attributes: normalizeAttrs(attrs),
  });
}

/**
 * Wrap an async function in a span. The span is always ended:
 * - fn resolves → status "ok", any attrs it set survive
 * - fn throws   → status "error", exception recorded, error rethrown
 *
 * The name "safe" refers to guaranteed span cleanup, NOT swallowing errors.
 */
export async function safeExecuteWithSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  attrs?: SpanAttrs,
): Promise<T> {
  const span = startSpan(name, attrs);
  try {
    const result = await fn(span);
    span.end("ok");
    return result;
  } catch (err) {
    span.recordException(err);
    span.end("error");
    throw err;
  }
}
