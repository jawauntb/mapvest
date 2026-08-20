/**
 * Demand-pulse math (Universe Roadmap §3 C3).
 *
 * Pure: edges + fundamentals in, pulse out. No network, no store. The API
 * layer (`apps/api/src/lib/demand-pulse.ts`) does I/O and caching around this.
 */
import type { CompanyEdge, DemandPulse, DemandPulseBuyer } from "@mapvest/core";
import type { CashFlowStatement, IncomeStatement } from "./marketData/router.js";

/** Weighted-average YoY percent above which demand reads as expanding. */
const EXPANDING_THRESHOLD = 3;
/** Weighted-average YoY percent below which demand reads as contracting. */
const CONTRACTING_THRESHOLD = -3;
/** Min days between two statements for them to count as a year apart. */
const YOY_MIN_DAYS = 300;
/** Max days between two statements for them to count as a year apart. */
const YOY_MAX_DAYS = 430;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The per-buyer fundamentals `computeDemandPulse` reads. */
export type BuyerFundamentals = {
  name?: string;
  income: IncomeStatement[];
  cashFlow: CashFlowStatement[];
};

/** Ticker (uppercase) → fundamentals. Absent ticker = buyer did not resolve. */
export type FundamentalsByTicker = Record<string, BuyerFundamentals>;

/** The pure part of a `DemandPulse`, before generation time / sources. */
export type ComputedDemandPulse = {
  buyers: DemandPulseBuyer[];
  pulse: number | null;
  interpretation: DemandPulse["interpretation"];
};

export type PeriodPoint = { period: string; fiscalDate: string; value: number };

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

export function revenuePoints(statements: IncomeStatement[]): PeriodPoint[] {
  return statements.flatMap((s) =>
    typeof s.revenue === "number" && Number.isFinite(s.revenue)
      ? [{ period: s.period, fiscalDate: s.fiscalDate, value: s.revenue }]
      : [],
  );
}

export function capexPoints(statements: CashFlowStatement[]): PeriodPoint[] {
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
