/**
 * Company value-chain graph (Universe Roadmap §3 C1).
 *
 * Routes:
 *   GET /v1/graph/:ticker → CompanyGraphResponse
 *
 * Cache-first, and only the cache is free: serving stored edges younger than
 * 30 days needs no auth and no quota (quote-history posture). A cache MISS
 * spends real provider money (three Exa searches + an OpenRouter judge
 * cascade), so generation is metered like every other billable path — the
 * caller must be identified (bearer session or `X-Device-Id`) and pass the
 * Phase 8 free-tier quota; the generation is recorded only when extraction
 * actually ran and succeeded, and concurrent callers sharing an in-flight
 * extraction are not double-charged.
 *
 * Empty results AND failures are negatively cached for an hour so a
 * thin-coverage or erroring ticker cannot hammer the judge. Never fabricates
 * edges — an extraction failure is a 502.
 */
import type { CompanyEdge, CompanyGraphResponse, Source, User } from "@mapvest/core";
import { type FilingRef, extractValueChain } from "@mapvest/finance";
import { Hono } from "hono";
import { listEdges, replaceEdges } from "../lib/edges-store.js";
import { MONTHLY_PRICE_USD, getEntitlementState, recordGeneration } from "../lib/entitlements.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { isTicker, upstreamFetch } from "../lib/underlying.js";
import { optionalAuth } from "../middleware/optionalAuth.js";
import { deviceIdFromRequest } from "../middleware/requireGenerationQuota.js";

/** Stored edges are considered fresh for 30 days (refresh on new filings). */
const FRESH_MS = 30 * 24 * 60 * 60 * 1000;
/** How long an empty extraction result suppresses re-generation. */
const NEGATIVE_TTL_MS = 60 * 60 * 1000;
/** Max filing citations handed to the extractor as evidence. */
const MAX_FILINGS = 6;
/** Max top-level sources on the response. */
const MAX_SOURCES = 10;

const inFlight = new Map<string, Promise<CompanyEdge[]>>();
const negativeCache = new Map<string, number>();

type SecCitation = { Form?: unknown; Label?: unknown; URL?: unknown };

/** Best-effort SEC citations from the sibling service; any failure yields []. */
async function fetchFilings(ticker: string): Promise<FilingRef[]> {
  try {
    const res = await upstreamFetch(`/api/sec/${ticker}`, { timeoutMs: 5_000 });
    if (!res.ok) return [];
    const j = (await res.json()) as { Citations?: unknown };
    const citations = Array.isArray(j?.Citations) ? (j.Citations as SecCitation[]) : [];
    const out: FilingRef[] = [];
    for (const c of citations) {
      const url = typeof c?.URL === "string" ? c.URL.trim() : "";
      if (!url) continue;
      const form = typeof c?.Form === "string" ? c.Form.trim() : "";
      const label = typeof c?.Label === "string" ? c.Label.trim() : "";
      const composed = [form, label].filter(Boolean).join(" ") || "SEC filing";
      out.push({ label: composed, url });
      if (out.length >= MAX_FILINGS) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function generate(ticker: string): Promise<CompanyEdge[]> {
  try {
    const filings = await fetchFilings(ticker);
    const extracted = await extractValueChain(ticker, { filings });
    if (extracted.length === 0) {
      negativeCache.set(ticker, Date.now() + NEGATIVE_TTL_MS);
      return [];
    }
    negativeCache.delete(ticker);
    return replaceEdges(ticker, extracted);
  } catch (err) {
    // A failing ticker is suppressed exactly like an empty one — otherwise a
    // persistent upstream error lets callers re-trigger the judge every request.
    negativeCache.set(ticker, Date.now() + NEGATIVE_TTL_MS);
    throw err;
  }
}

function dedupeSources(edges: CompanyEdge[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const e of edges) {
    for (const s of e.sources) {
      const key = s.url ?? `${s.provider}:${s.confidence}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= MAX_SOURCES) return out;
    }
  }
  return out;
}

function newestCreatedAt(edges: CompanyEdge[]): number {
  let newest = 0;
  for (const e of edges) {
    const t = Date.parse(e.createdAt);
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return newest;
}

function respond(ticker: string, edges: CompanyEdge[]): CompanyGraphResponse {
  const newest = newestCreatedAt(edges);
  return {
    ticker,
    edges,
    count: edges.length,
    generatedAt: newest > 0 ? new Date(newest).toISOString() : new Date().toISOString(),
    sources: dedupeSources(edges),
  };
}

const graph = new Hono();

graph.get("/:ticker", optionalAuth, async (c) => {
  return safeExecuteWithSpan("http.graph", async (span) => {
    const ticker = c.req.param("ticker").trim().toUpperCase();
    if (!isTicker(ticker)) {
      span.setAttribute("error.kind", "invalid_ticker");
      return c.json({ error: "invalid ticker" }, 400);
    }
    span.setAttribute("ticker", ticker);

    const cached = await listEdges(ticker);
    const newest = newestCreatedAt(cached);
    if (cached.length > 0 && Date.now() - newest < FRESH_MS) {
      span.setAttributes({ cache: "hit", count: cached.length });
      return c.json(respond(ticker, cached));
    }

    const suppressedUntil = negativeCache.get(ticker) ?? 0;
    if (Date.now() < suppressedUntil) {
      span.setAttributes({ cache: "negative", count: 0 });
      return c.json(respond(ticker, []));
    }
    negativeCache.delete(ticker);

    // Past this point extraction spends Exa + OpenRouter money — meter it the
    // same way identify/agent/memo are (lib/entitlements.ts). Cache hits above
    // stay free and identity-less.
    const user = (c as unknown as { get: (k: string) => User | undefined }).get("user");
    const deviceId = deviceIdFromRequest(c);
    if (!user && !deviceId) {
      span.setAttribute("error.kind", "no_identity");
      return c.json(
        { error: "X-Device-Id header (or a bearer session) required to generate a graph" },
        400,
      );
    }
    const state = await getEntitlementState({ userId: user?.id, deviceId, email: user?.email });
    if (!state.canGenerate) {
      span.setAttribute("error.kind", "quota_exceeded");
      return c.json(
        {
          error: "generation quota exceeded",
          code: "quota_exceeded" as const,
          remaining: state.remaining,
          limit: state.limit,
          priceUsd: MONTHLY_PRICE_USD,
          interval: "month" as const,
        },
        402,
      );
    }

    let pending = inFlight.get(ticker);
    const shared = Boolean(pending);
    if (!pending) {
      pending = generate(ticker).finally(() => inFlight.delete(ticker));
      inFlight.set(ticker, pending);
    }
    span.setAttributes({ cache: "miss", in_flight_shared: shared });

    let edges: CompanyEdge[];
    try {
      edges = await pending;
    } catch (err) {
      span.setAttribute("error.kind", "extraction_failed");
      return c.json({ error: err instanceof Error ? err.message : "graph extraction failed" }, 502);
    }

    // Charge only the caller that initiated the extraction; concurrent callers
    // that shared the in-flight promise consumed no additional provider calls.
    if (!shared) {
      await recordGeneration({ userId: user?.id, deviceId, kind: "graph" }).catch(() => {});
    }

    span.setAttribute("count", edges.length);
    return c.json(respond(ticker, edges));
  });
});

export default graph;
