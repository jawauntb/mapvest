import { Hono } from "hono";
import type { IdentifyResponse, Investable, PhotoIdentification, Source } from "@mapvest/core";
import { identifyFromImageWithUsage } from "@mapvest/vision";
import { resolveComparable, resolveEtfExposure, resolveTicker } from "@mapvest/finance";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { recordCost } from "../lib/costTelemetry.js";
import type { AuthEnv } from "../middleware/bearerAuth.js";
import { identifyGuards } from "../middleware/identifyGuards.js";
import { sanitizeOcrString } from "../lib/sanitize.js";

const identify = new Hono<Partial<AuthEnv>>();

/** 8 MB. Anything larger is rejected with 413 before we call the model. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

identify.use("*", identifyGuards);

/**
 * Scrub every OCR-derived string on the identification payload so that
 * control characters and oversized values never leave the API. Runs on the
 * top-level `visibleText` array and on the string fields of each detection
 * entry — this is our prompt-injection guardrail: nothing the model
 * produces is echoed back verbatim.
 */
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

    const user = (c as unknown as { get: (k: string) => { id?: string } | undefined }).get(
      "user",
    );
    span.setAttributes({
      image_size_bytes: bytes.byteLength,
      has_location: Boolean(location),
      user_id: user?.id,
    });

    const started = performance.now();
    const { identification: rawIdentification, usage } = await identifyFromImageWithUsage(
      bytes,
      { location },
    );
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

    const investables: Investable[] = [];
    for (const d of identification.detected) {
      if (!d.brand) continue;
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
        investables.push({
          brand,
          comparables: [],
          etfs: [],
          confidence: d.confidence,
          sources: publicSources,
        });
      } else {
        const [comparables, etfs] = await Promise.all([
          resolveComparable(d.brand, d.sector),
          resolveEtfExposure(d.sector ?? d.brand),
        ]);
        investables.push({
          brand,
          comparables,
          etfs,
          confidence: d.confidence === "high" ? "medium" : "low",
          sources: publicSources,
        });
      }
    }

    span.setAttribute("investables_count", investables.length);
    const resp: IdentifyResponse = { identification, investables };
    return c.json(resp);
  });
});

export default identify;
