import type { IdentifyResponse, Investable, PhotoIdentification, Source } from "@mapvest/core";
import type { Quote } from "@mapvest/core";
import { getQuote, resolveComparable, resolveEtfExposure, resolveTicker } from "@mapvest/finance";
import { identifyFromImageWithUsage } from "@mapvest/vision";
import { Hono } from "hono";
import { recordCost } from "../lib/costTelemetry.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { onIdentifyFinished } from "../lib/notifiers/imageNotifier.js";
import { sanitizeOcrString } from "../lib/sanitize.js";
import type { AuthEnv } from "../middleware/bearerAuth.js";
import { identifyGuards } from "../middleware/identifyGuards.js";
import { optionalAuth } from "../middleware/optionalAuth.js";
import { requireGenerationQuota } from "../middleware/requireGenerationQuota.js";

const identify = new Hono<Partial<AuthEnv>>();

/** 8 MB. Anything larger is rejected with 413 before we call the model. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// optionalAuth first so identifyGuards' per-user bucket + the quota check
// below both see c.get("user") when a session bearer token is present.
identify.use("*", optionalAuth);
identify.use("*", identifyGuards);
identify.use("*", requireGenerationQuota("identify"));

/**
 * Scrub every OCR-derived string on the identification payload so that
 * control characters and oversized values never leave the API. Runs on the
 * top-level `visibleText` array and on the string fields of each detection
 * entry — this is our prompt-injection guardrail: nothing the model
 * produces is echoed back verbatim.
 */
/**
 * Best-effort quote fetch bounded by `timeoutMs`. Wraps getQuote() in a race
 * so a slow Yahoo response can't blow up identify latency. Returns null on
 * timeout, upstream failure, or any thrown error.
 */
async function bestEffortQuote(symbol: string, timeoutMs = 500): Promise<Quote | null> {
  try {
    return await Promise.race<Promise<Quote | null>>([
      getQuote(symbol),
      new Promise<Quote | null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

function sanitizeIdentification(id: PhotoIdentification): PhotoIdentification {
  return {
    ...id,
    visibleText: (id.visibleText ?? [])
      .map((s) => sanitizeOcrString(s))
      .filter((s): s is string => typeof s === "string"),
    detected: id.detected.map((d) => ({
      ...d,
      brand: sanitizeOcrString(d.brand),
      product: sanitizeOcrString(d.product),
      sector: sanitizeOcrString(d.sector),
    })),
  };
}

identify.post("/", async (c) => {
  return safeExecuteWithSpan("http.identify", async (span) => {
    // Fast-fail on Content-Length so we don't buffer a 100MB body just to
    // reject it. formData() below reads the body; anything the header
    // claims is over the cap gets 413 before we touch it.
    const declaredLen = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(declaredLen) && declaredLen > MAX_IMAGE_BYTES) {
      span.setAttribute("error.kind", "image_too_large");
      return c.json({ error: "image too large (max 8MB)" }, 413);
    }

    const form = await c.req.formData();
    const file = form.get("image");
    const lat = form.get("lat");
    const lng = form.get("lng");
    if (!(file instanceof File)) {
      span.setAttribute("error.kind", "missing_image");
      return c.json({ error: "image required" }, 400);
    }

    if (!file.type || !file.type.startsWith("image/")) {
      span.setAttribute("error.kind", "unsupported_media_type");
      return c.json({ error: "unsupported media type (expected image/*)" }, 415);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      span.setAttribute("error.kind", "image_too_large");
      return c.json({ error: "image too large (max 8MB)" }, 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const location = lat && lng ? { lat: Number(lat), lng: Number(lng) } : undefined;

    const user = (c as unknown as { get: (k: string) => { id?: string } | undefined }).get("user");
    span.setAttributes({
      image_size_bytes: bytes.byteLength,
      has_location: Boolean(location),
      user_id: user?.id,
    });

    const started = performance.now();
    const { identification: rawIdentification, usage } = await identifyFromImageWithUsage(bytes, {
      location,
    });
    const identification = sanitizeIdentification(rawIdentification);
    const latencyMs = Math.round(performance.now() - started);

    // Confidence of the top detection is a useful telemetry signal.
    const topConfidence = identification.detected?.[0]?.confidence;
    span.setAttributes({
      model_used: usage.model,
      latency_ms: latencyMs,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      result_confidence: topConfidence,
      detected_count: identification.detected?.length ?? 0,
    });

    recordCost({
      ts: new Date().toISOString(),
      path: "/v1/identify",
      openrouter: {
        model: usage.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        latencyMs: usage.latencyMs,
      },
      requestId: c.req.header("x-request-id"),
    });

    // Detections are independent of each other — resolve ticker/quote/
    // comparable/ETF for each in parallel instead of one at a time. An
    // index-mapped Promise.all preserves `identification.detected` order in
    // the output regardless of which detection resolves first, and a brand-
    // less detection resolves to `null` so it can be filtered out afterward
    // without disturbing the ordering of the rest.
    const resolvedInvestables = await Promise.all(
      identification.detected.map(async (d): Promise<Investable | null> => {
        if (!d.brand) return null;
        const { brand, sources } = await resolveTicker(d.brand);
        const publicSources: Source[] = [
          ...sources,
          {
            provider: "openrouter",
            fetchedAt: new Date().toISOString(),
            confidence: d.confidence,
          },
        ];

        if (brand.isPublic) {
          // Best-effort: attach a delayed quote for public brands. Bounded to
          // 500 ms so identify latency stays flat even if Yahoo is slow.
          const q = brand.ticker?.symbol ? await bestEffortQuote(brand.ticker.symbol) : null;
          return {
            brand,
            comparables: [],
            etfs: [],
            confidence: d.confidence,
            sources: publicSources,
            ...(q ? { quote: q } : {}),
          };
        }

        const [comparables, etfs] = await Promise.all([
          resolveComparable(d.brand, d.sector),
          resolveEtfExposure(d.sector ?? d.brand),
        ]);
        return {
          brand,
          comparables,
          etfs,
          confidence: d.confidence === "high" ? "medium" : "low",
          sources: publicSources,
        };
      }),
    );
    const investables: Investable[] = resolvedInvestables.filter(
      (i): i is Investable => i !== null,
    );

    span.setAttribute("investables_count", investables.length);
    // Fire-and-forget push (opted-in authenticated users only). Picks the
    // first investable's brand + ticker (if any) so the notification carries
    // enough context for deep-linking.
    if (user?.id && investables.length > 0) {
      const top = investables[0];
      const brand = top?.brand.name;
      const ticker = top?.brand.ticker?.symbol;
      onIdentifyFinished(user.id, brand, ticker).catch(() => {});
    }
    const resp: IdentifyResponse = { identification, investables };
    return c.json(resp);
  });
});

export default identify;
