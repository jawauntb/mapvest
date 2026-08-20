/**
 * Demand pulse (Universe Roadmap §3 C3).
 *
 * "Is the money upstream of this company growing or shrinking." A ticker's
 * `buys_from` edges name the companies that BUY from it; joining those buyers to
 * their own income-statement / cash-flow trajectories turns the value chain into
 * one directional signal about the demand sitting above the subject company.
 *
 * Split deliberately in two:
 *   - `computeDemandPulse` is PURE and lives in `packages/finance` — edges +
 *     fundamentals in, pulse out. Every interpretation branch is testable
 *     offline with no network and no DB.
 *   - `buildDemandPulse` does the I/O — reads the edge store, fetches provider
 *     fundamentals per buyer, and caches for 24h.
 *
 * Hard rules:
 *   - Reading edges NEVER triggers graph generation. A ticker with no stored
 *     graph yields `pulse: null` / `interpretation: "unknown"`, not an
 *     extraction run and not a guess (`GET /v1/graph/:ticker` is the only path
 *     that spends judge money).
 *   - A buyer whose fundamentals do not resolve keeps `weight: 0` and omits its
 *     YoY fields — never zero-filled (AGENTS.md §2.4).
 *   - `sources` are the real provider citations returned alongside the
 *     statements that were actually fetched (AGENTS.md §6).
 */
import type { DemandPulse, Source } from "@mapvest/core";
import {
  type BuyerFundamentals,
  type FundamentalsByTicker,
  buyerEdges,
  computeDemandPulse,
  getCashFlowStatements,
  getIncomeStatements,
} from "@mapvest/finance";
import { listEdges } from "./edges-store.js";

export type {
  BuyerFundamentals,
  ComputedDemandPulse,
  FundamentalsByTicker,
} from "@mapvest/finance";
export { buyerEdges, computeDemandPulse, yoyPercent } from "@mapvest/finance";

/** Max buyers we spend provider calls on per pulse. */
const MAX_BUYERS = 6;
/** Statements pulled per buyer — enough to reach the same period a year back. */
const STATEMENT_LIMIT = 8;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Max top-level sources on the response. */
const MAX_SOURCES = 12;

type CachedBuyerFundamentals = BuyerFundamentals & { sources?: Source[] };

// ---------------- Cache ----------------

type CacheEntry = { expiresAt: number; pulse: DemandPulse };
const pulseCache = new Map<string, CacheEntry>();

/** Test-only. Public callers should not reach in. */
export function _clearDemandPulseCache(): void {
  pulseCache.clear();
}

/**
 * Cached pulse for `ticker`, or null. The route uses this to decide whether a
 * request is free (cache hit) or billable (miss) — same posture as
 * `GET /v1/graph/:ticker`.
 */
export function readDemandPulseCache(ticker: string): DemandPulse | null {
  const key = ticker.trim().toUpperCase();
  const hit = pulseCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    pulseCache.delete(key);
    return null;
  }
  return hit.pulse;
}

// ---------------- I/O ----------------

function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of sources) {
    const key = s.url ?? `${s.provider}:${s.confidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

/**
 * Fundamentals for one buyer. Every failure mode — unconfigured provider,
 * 501 from a provider without statement support, upstream error, thin
 * coverage — degrades to "this buyer did not resolve" rather than failing the
 * whole pulse.
 */
async function fetchBuyerFundamentals(
  ticker: string,
  name: string,
): Promise<CachedBuyerFundamentals | null> {
  try {
    const [income, cashFlow] = await Promise.all([
      getIncomeStatements(ticker, { limit: STATEMENT_LIMIT }),
      getCashFlowStatements(ticker, { limit: STATEMENT_LIMIT }),
    ]);
    if (income.results.length === 0 && cashFlow.results.length === 0) return null;
    return {
      name,
      income: income.results,
      cashFlow: cashFlow.results,
      sources: [...income.sources, ...cashFlow.sources],
    };
  } catch (err) {
    console.warn(`[demand-pulse] fundamentals unavailable for ${ticker}:`, err);
    return null;
  }
}

/**
 * Build (or serve from the 24h cache) the demand pulse for `ticker`.
 *
 * Reads stored edges only — no graph generation. Never throws: a ticker with no
 * graph, or one whose buyers all fail to resolve, comes back as a well-formed
 * `unknown` pulse with an empty `sources` array.
 */
export async function buildDemandPulse(
  ticker: string,
  opts?: { now?: Date },
): Promise<DemandPulse> {
  const key = ticker.trim().toUpperCase();
  const cached = readDemandPulseCache(key);
  if (cached) return cached;

  const now = opts?.now ?? new Date();
  const edges = await listEdges(key);
  const candidates = buyerEdges(edges).slice(0, MAX_BUYERS);

  const fundamentalsByTicker: FundamentalsByTicker = {};
  const sources: Source[] = [];
  const settled = await Promise.all(
    candidates.map(async (edge) => {
      const buyerTicker = (edge.dstTicker ?? "").trim().toUpperCase();
      return { buyerTicker, data: await fetchBuyerFundamentals(buyerTicker, edge.dstName) };
    }),
  );
  for (const { buyerTicker, data } of settled) {
    if (!data) continue;
    fundamentalsByTicker[buyerTicker] = data;
    sources.push(...(data.sources ?? []));
  }

  const computed = computeDemandPulse(candidates, fundamentalsByTicker);
  const pulse: DemandPulse = {
    ticker: key,
    buyers: computed.buyers,
    pulse: computed.pulse,
    interpretation: computed.interpretation,
    generatedAt: now.toISOString(),
    sources: dedupeSources(sources),
  };
  pulseCache.set(key, { pulse, expiresAt: Date.now() + CACHE_TTL_MS });
  return pulse;
}
