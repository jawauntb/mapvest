/**
 * Demand pulse (Universe Roadmap §3 C3).
 *
 * "Is the money upstream of this company growing or shrinking." A ticker's
 * `buys_from` edges name the companies that BUY from it; joining those buyers to
 * their own income-statement / cash-flow trajectories turns the value chain into
 * one directional signal about the demand sitting above the subject company.
 *
 * Split deliberately in two:
 *   - `computeDemandPulse` is PURE — edges + fundamentals in, pulse out. Every
 *     interpretation branch is testable offline with no network and no DB.
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
import type { CompanyEdge, DemandPulse, DemandPulseBuyer, Source } from "@mapvest/core";
import {
  type CashFlowStatement,
  type IncomeStatement,
  getCashFlowStatements,
  getIncomeStatements,
} from "@mapvest/finance";
import { listEdges } from "./edges-store.js";

/** Weighted-average YoY percent above which demand reads as expanding. */
const EXPANDING_THRESHOLD = 3;
/** Weighted-average YoY percent below which demand reads as contracting. */
const CONTRACTING_THRESHOLD = -3;
/** Max buyers we spend provider calls on per pulse. */
const MAX_BUYERS = 6;
/** Statements pulled per buyer — enough to reach the same period a year back. */
const STATEMENT_LIMIT = 8;
/** Min days between two statements for them to count as a year apart. */
const YOY_MIN_DAYS = 300;
/** Max days between two statements for them to count as a year apart. */
const YOY_MAX_DAYS = 430;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Max top-level sources on the response. */
const MAX_SOURCES = 12;

/** The per-buyer fundamentals `computeDemandPulse` reads. */
export type BuyerFundamentals = {
  name?: string;
  income: IncomeStatement[];
  cashFlow: CashFlowStatement[];
  sources?: Source[];
};

/** Ticker (uppercase) → fundamentals. Absent ticker = buyer did not resolve. */
export type FundamentalsByTicker = Record<string, BuyerFundamentals>;

/** The pure part of a `DemandPulse`, before generation time / sources. */
export type ComputedDemandPulse = {
  buyers: DemandPulseBuyer[];
  pulse: number | null;
  interpretation: DemandPulse["interpretation"];
};

type PeriodPoint = { period: string; fiscalDate: string; value: number };

function daysBetween(laterIso: string, earlierIso: string): number | null {
  const later = Date.parse(laterIso);
  const earlier = Date.parse(earlierIso);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return null;
  return (later - earlier) / DAY_MS;
}

/**
 * YoY percent change from the newest point to the most recent earlier point
 * roughly one year back (300-430 days). Matching on the elapsed window rather
 * than on array position works for annual and quarterly filers alike, and
 * returns `undefined` — never 0 — when no comparable prior period exists or the
 * base period is zero/negative.
 */
export function yoyPercent(points: PeriodPoint[]): number | undefined {
  const usable = points
    .filter((p) => Number.isFinite(p.value) && Boolean(p.fiscalDate))
    .sort((a, b) => b.fiscalDate.localeCompare(a.fiscalDate));
  const latest = usable[0];
  if (!latest) return undefined;
  for (const prior of usable.slice(1)) {
    const gap = daysBetween(latest.fiscalDate, prior.fiscalDate);
    if (gap === null || gap < YOY_MIN_DAYS || gap > YOY_MAX_DAYS) continue;
    if (!(prior.value > 0)) return undefined;
    return ((latest.value - prior.value) / prior.value) * 100;
  }
  return undefined;
}

function revenuePoints(statements: IncomeStatement[]): PeriodPoint[] {
  return statements.flatMap((s) =>
    typeof s.revenue === "number" && Number.isFinite(s.revenue)
      ? [{ period: s.period, fiscalDate: s.fiscalDate, value: s.revenue }]
      : [],
  );
}

function capexPoints(statements: CashFlowStatement[]): PeriodPoint[] {
  return statements.flatMap((s) =>
    typeof s.capex === "number" && Number.isFinite(s.capex)
      ? [{ period: s.period, fiscalDate: s.fiscalDate, value: s.capex }]
      : [],
  );
}

/** Unique `buys_from` counterparties that carry a real ticker, heaviest first. */
export function buyerEdges(edges: CompanyEdge[]): CompanyEdge[] {
  const byTicker = new Map<string, CompanyEdge>();
  for (const edge of edges) {
    if (edge.edgeType !== "buys_from") continue;
    const ticker = edge.dstTicker?.trim().toUpperCase();
    if (!ticker) continue; // private buyer — no fundamentals to join, never invented
    const existing = byTicker.get(ticker);
    if (!existing || edge.weight > existing.weight) byTicker.set(ticker, edge);
  }
  return [...byTicker.values()].sort((a, b) => b.weight - a.weight);
}

/**
 * PURE. Weighted-average demand signal across a ticker's buyers.
 *
 * Per buyer the signal is the mean of whichever YoY components resolved —
 * revenue growth alone, capex growth alone, or the average of the two when both
 * are present. Buyer signals are then combined with weights taken from the
 * originating `CompanyEdge.weight` and normalized across the buyers that
 * actually resolved; buyers that did not resolve stay in the list at weight 0 so
 * the client can see who was looked at and came back empty.
 *
 * `pulse` is `null` (never 0) when no buyer resolved, and `interpretation` is
 * then `"unknown"`.
 */
export function computeDemandPulse(
  edges: CompanyEdge[],
  fundamentalsByTicker: FundamentalsByTicker,
): ComputedDemandPulse {
  const candidates = buyerEdges(edges);
  const buyers: DemandPulseBuyer[] = [];
  const resolved: Array<{ index: number; edgeWeight: number; signal: number }> = [];

  for (const edge of candidates) {
    const ticker = (edge.dstTicker ?? "").trim().toUpperCase();
    const fundamentals = fundamentalsByTicker[ticker];
    const revenueYoY = fundamentals ? yoyPercent(revenuePoints(fundamentals.income)) : undefined;
    const capexYoY = fundamentals ? yoyPercent(capexPoints(fundamentals.cashFlow)) : undefined;

    const buyer: DemandPulseBuyer = {
      ticker,
      name: fundamentals?.name ?? edge.dstName,
      weight: 0,
    };
    if (revenueYoY !== undefined) buyer.revenueYoY = revenueYoY;
    if (capexYoY !== undefined) buyer.capexYoY = capexYoY;

    const components = [revenueYoY, capexYoY].filter((v): v is number => v !== undefined);
    if (components.length > 0) {
      const signal = components.reduce((sum, v) => sum + v, 0) / components.length;
      resolved.push({ index: buyers.length, edgeWeight: edge.weight, signal });
    }
    buyers.push(buyer);
  }

  if (resolved.length === 0) {
    return { buyers, pulse: null, interpretation: "unknown" };
  }

  const totalWeight = resolved.reduce((sum, r) => sum + r.edgeWeight, 0);
  // All-zero edge weights still carry real fundamentals — fall back to an equal
  // split rather than dividing by zero and losing the signal.
  const normalized = resolved.map((r) => ({
    ...r,
    weight: totalWeight > 0 ? r.edgeWeight / totalWeight : 1 / resolved.length,
  }));
  for (const r of normalized) {
    const buyer = buyers[r.index];
    if (buyer) buyer.weight = Math.min(1, Math.max(0, r.weight));
  }

  const pulse = normalized.reduce((sum, r) => sum + r.weight * r.signal, 0);
  const interpretation: DemandPulse["interpretation"] =
    pulse > EXPANDING_THRESHOLD
      ? "expanding"
      : pulse < CONTRACTING_THRESHOLD
        ? "contracting"
        : "mixed";
  return { buyers, pulse, interpretation };
}

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
): Promise<BuyerFundamentals | null> {
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
