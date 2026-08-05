import { Hono } from "hono";
import { getQuote } from "@mapvest/finance";
import { safeExecuteWithSpan } from "../lib/logfire.js";

const quote = new Hono();

/**
 * GET /v1/quote?symbol=HSY
 *
 * Thin wrapper around finance.getQuote(). Returns { quote } on success and
 * { error } on missing or unresolvable symbol. The upstream call is best-
 * effort with a 3s timeout, so worst case we return { error } and the caller
 * decides whether to retry.
 */
quote.get("/", async (c) => {
  return safeExecuteWithSpan("http.quote", async (span) => {
    const symbol = (c.req.query("symbol") ?? "").trim();
    if (!symbol) {
      span.setAttribute("error.kind", "missing_symbol");
      return c.json({ error: "symbol required" }, 400);
    }
    span.setAttribute("symbol", symbol.toUpperCase());

    const started = performance.now();
    const q = await getQuote(symbol);
    const latencyMs = Math.round(performance.now() - started);
    span.setAttributes({
      latency_ms: latencyMs,
      quote_hit: q !== null,
    });

    if (!q) {
      return c.json({ error: "quote unavailable" }, 502);
    }
    return c.json({ quote: q });
  });
});

export default quote;
