/**
 * Company value chain + demand pulse (Universe Roadmap §3 C1–C3).
 *
 * Two read-only endpoints behind the Orbit view:
 *   GET /v1/graph/:ticker → CompanyGraphResponse — cited supplier / buyer /
 *     competitor / complement edges for one company.
 *   GET /v1/pulse/:ticker → DemandPulse — is the money upstream of this
 *     company growing or shrinking.
 *
 * Both are metered like every other billable path: a cache hit is free and
 * identity-less, a miss spends provider money and needs an identified caller.
 * `apiFetch` already attaches `X-Device-Id` (and the bearer token when the
 * user is signed in), which is exactly the identity those routes look for —
 * that is why these live on the shared fetcher rather than a bare `fetch`.
 *
 * Both callers **fail soft**: the endpoints ship this wave, so every screen
 * must render exactly as it did before when they 404. Use `retry: false` and
 * only ever read `.data` (see app/detail/[id].tsx and app/orbit/[ticker].tsx).
 *
 * Types below are hand-mirrors of `CompanyGraphResponse` / `CompanyEdge` /
 * `DemandPulse` in packages/core/src/schemas/index.ts — keep in lockstep, the
 * zod schemas are the source of truth (AGENTS.md §3).
 */
import { type FetchOpts, apiFetch } from "./http";
import type { Source } from "./types";

/**
 * Direction of a company-to-company relationship, read from the subject
 * ticker's point of view: `supplies` means the counterparty sells TO the
 * subject (a supplier), `buys_from` means it BUYS from the subject (a
 * customer). `competes_with` / `complements` are lateral.
 */
export type CompanyEdgeType = "supplies" | "buys_from" | "competes_with" | "complements";

/**
 * One cited edge in a company's value chain. Private counterparties keep
 * `dstName` with **no** `dstTicker` — the server never invents one, so the
 * client must treat a missing ticker as "not investable", not as an error.
 */
export type CompanyEdge = {
  id: string;
  srcTicker: string;
  dstTicker?: string;
  dstName: string;
  edgeType: CompanyEdgeType;
  /** 0–1 relationship strength; drives node emphasis in the Orbit view. */
  weight: number;
  reasoning: string;
  sources: Source[];
  /** Filing period the evidence came from, when known. */
  asOf?: string;
  createdAt: string;
};

export type CompanyGraphResponse = {
  ticker: string;
  edges: CompanyEdge[];
  count: number;
  generatedAt: string;
  sources: Source[];
};

/**
 * One buyer contributing to a demand pulse. `revenueYoY` / `capexYoY` are
 * percent changes and are **omitted** — never zero-filled — when the provider
 * returned no usable series (AGENTS.md §2.4).
 */
export type DemandPulseBuyer = {
  ticker: string;
  name?: string;
  revenueYoY?: number;
  capexYoY?: number;
  weight: number;
};

export type DemandPulseInterpretation = "expanding" | "contracting" | "mixed" | "unknown";

/**
 * `pulse` is the weighted average buyer YoY percent and is `null` — not 0 —
 * when no buyer fundamentals resolved; `interpretation` is then `"unknown"`.
 */
export type DemandPulse = {
  ticker: string;
  buyers: DemandPulseBuyer[];
  pulse: number | null;
  interpretation: DemandPulseInterpretation;
  generatedAt: string;
  sources: Source[];
};

/** Normalized the same way the routes do, so cache keys match across screens. */
function symbol(ticker: string): string {
  return encodeURIComponent(ticker.trim().toUpperCase());
}

/** Cited value chain for one ticker. Throws `ApiError` — callers fail soft. */
export function fetchCompanyGraph(
  ticker: string,
  opts: FetchOpts = {},
): Promise<CompanyGraphResponse> {
  return apiFetch<CompanyGraphResponse>(`/v1/graph/${symbol(ticker)}`, { method: "GET" }, opts);
}

/** Demand pulse for one ticker. Throws `ApiError` — callers fail soft. */
export function fetchDemandPulse(ticker: string, opts: FetchOpts = {}): Promise<DemandPulse> {
  return apiFetch<DemandPulse>(`/v1/pulse/${symbol(ticker)}`, { method: "GET" }, opts);
}
