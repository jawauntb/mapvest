import { Hono } from "hono";
import type { ResolveComparableResponse } from "@mapvest/core";
import { resolveComparable, resolveEtfExposure, resolveTicker } from "@mapvest/finance";
import { safeExecuteWithSpan } from "../lib/logfire.js";

const resolve = new Hono();

resolve.post("/", async (c) => {
  return safeExecuteWithSpan("http.resolve_comparable", async (span) => {
    const body = await c.req.json<{ brand: string; hintSector?: string }>();
    if (!body.brand) {
      span.setAttribute("error.kind", "missing_brand");
      return c.json({ error: "brand required" }, 400);
    }

    const user = (c as unknown as { get: (k: string) => { id?: string } | undefined }).get(
      "user",
    );
    span.setAttributes({
      brand: body.brand,
      hint_sector: body.hintSector,
      user_id: user?.id,
    });

    const started = performance.now();
    const { brand } = await resolveTicker(body.brand);
    const [comparables, etfs] = await Promise.all([
      brand.isPublic ? Promise.resolve([]) : resolveComparable(body.brand, body.hintSector),
      resolveEtfExposure(body.hintSector ?? body.brand),
    ]);
    const latencyMs = Math.round(performance.now() - started);

    // Best-available comparable's score is a decent proxy for result quality:
    // >=0.66 → high, >=0.33 → medium, else low. If the brand is already
    // public we mark high; if we have nothing we mark low.
    const topScore = comparables[0]?.score;
    const topConfidence =
      brand.isPublic
        ? "high"
        : typeof topScore === "number"
          ? topScore >= 0.66
            ? "high"
            : topScore >= 0.33
              ? "medium"
              : "low"
          : "low";
    span.setAttributes({
      latency_ms: latencyMs,
      is_public: brand.isPublic,
      resolved_ticker: brand.ticker,
      comparables_count: comparables.length,
      etfs_count: etfs.length,
      top_score: topScore,
      result_confidence: topConfidence,
    });

    const resp: ResolveComparableResponse = { brand, comparables, etfs };
    return c.json(resp);
  });
});

export default resolve;
