/**
 * Counterfactual universe portfolio (Universe Roadmap §1 A3).
 *
 * Routes (bearer-required, mounted at /v1/universe by the integrator):
 *   GET /summary → UniverseSummary
 *
 * Reads the caller's finds journal, fetches one quote per distinct effective
 * ticker, and hands both to the pure `computeUniverseSummary`. A quote that
 * fails or comes back null just drops its finds out of the valued set — we
 * never estimate a missing price (AGENTS.md §2.4).
 */
import type { Quote, UniverseSummary } from "@mapvest/core";
import { getQuote } from "@mapvest/finance";
import { Hono } from "hono";
import { listFinds } from "../lib/finds-store.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { computeUniverseSummary, effectiveTicker } from "../lib/universe-summary.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

/** Finds pulled per summary — matches the finds journal's MAX_LIMIT. */
const FINDS_LIMIT = 200;
/** Upstream quote calls in flight at once; keeps a 200-find universe polite. */
const QUOTE_CONCURRENCY = 6;

const universe = new Hono<AuthEnv>();
universe.use("*", bearerAuth);

universe.get("/summary", async (c) => {
  return safeExecuteWithSpan("http.universe.summary", async (span) => {
    const user = c.get("user");
    const finds = await listFinds(user.id, FINDS_LIMIT);

    const symbols = [...new Set(finds.map(effectiveTicker).filter((s): s is string => !!s))];

    const quotes = new Map<string, Quote>();
    for (let i = 0; i < symbols.length; i += QUOTE_CONCURRENCY) {
      const batch = symbols.slice(i, i + QUOTE_CONCURRENCY);
      await Promise.all(
        batch.map(async (symbol) => {
          try {
            const q = await getQuote(symbol);
            if (q) quotes.set(symbol, q);
          } catch {
            // Best-effort: an unresolvable symbol excludes its finds from the
            // valued set rather than failing the whole summary.
          }
        }),
      );
    }

    const summary: UniverseSummary = computeUniverseSummary(finds, quotes);
    span.setAttributes({
      user_id: user.id,
      find_count: summary.findCount,
      valued_finds: summary.valuedFinds,
      symbols_requested: symbols.length,
      quotes_resolved: quotes.size,
    });
    return c.json(summary);
  });
});

export default universe;
