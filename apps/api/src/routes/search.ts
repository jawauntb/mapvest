import { SearchIntentRequest } from "@mapvest/core";
import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { resolveSearchIntent } from "../lib/search-intent.js";

/**
 * POST /v1/search/intent  { q, lat?, lng? } → SearchIntentResponse
 *
 * Decides whether free text in the search box means a ticker, a brand, a
 * place, or a question, and where the client should navigate (see
 * lib/search-intent.ts). Public; never errors on an unclassifiable query —
 * that falls open to `intent: "ticker"` with today's behavior.
 */
const search = new Hono();

search.post("/intent", async (c) => {
  return safeExecuteWithSpan("http.search_intent", async (span) => {
    const body = await c.req.json().catch(() => null);
    const parsed = SearchIntentRequest.safeParse(body);
    if (!parsed.success) {
      span.setAttribute("error.kind", "invalid_body");
      return c.json({ error: "q required (1-200 chars)" }, 400);
    }
    const started = performance.now();
    const result = await resolveSearchIntent(parsed.data);
    span.setAttributes({
      q_len: parsed.data.q.length,
      has_geo: typeof parsed.data.lat === "number",
      intent: result.intent,
      method: result.method,
      probability: result.probability,
      latency_ms: Math.round(performance.now() - started),
    });
    return c.json(result);
  });
});

export default search;
