import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { buildRating, readRatingCache } from "../lib/rating.js";
import { isTicker } from "../lib/underlying.js";

/**
 * GET /v1/rating/:ticker → RatingResponse
 *
 * The hero-chip rating (see lib/rating.ts). Same auth posture as
 * `/v1/analysis`: public, no session required. Never 5xx because a signal
 * was unavailable — an unratable ticker is a 200 with
 * `status: "insufficient_signal"`. Memoized in-process for an hour per ticker.
 */
const rating = new Hono();

rating.get("/:ticker", async (c) => {
  return safeExecuteWithSpan("http.rating", async (span) => {
    const ticker = (c.req.param("ticker") ?? "").trim().toUpperCase();
    if (!isTicker(ticker)) {
      span.setAttribute("error.kind", "invalid_ticker");
      return c.json({ error: "ticker required (e.g. MCD)" }, 400);
    }
    const cacheHit = readRatingCache(ticker) !== null;
    span.setAttributes({ ticker, cache: cacheHit ? "hit" : "miss" });

    const started = performance.now();
    const result = await buildRating(ticker);
    span.setAttributes({
      latency_ms: Math.round(performance.now() - started),
      status: result.status,
      action: result.rating?.action ?? "none",
      confidence: result.confidence,
      inputs: result.inputs_used.join(","),
    });
    c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=900");
    return c.json(result);
  });
});

export default rating;
