/**
 * Company value chain + demand pulse (Universe Roadmap §3 C1–C3).
 *
 * Two read-only endpoints behind the Orbit view:
 *   GET /v1/graph/:ticker → CompanyGraphResponse
 *   GET /v1/pulse/:ticker → DemandPulse
 *
 * Types live in `./types` as zod mirrors of packages/core (AGENTS.md §3).
 * Both callers fail soft: use `retry: false` and only ever read `.data`.
 */
import { type FetchOpts, apiFetch } from "./http";
import type { CompanyGraphResponse, DemandPulse } from "./types";

export type {
  CompanyEdge,
  CompanyEdgeType,
  CompanyGraphResponse,
  DemandPulse,
  DemandPulseBuyer,
  DemandPulseInterpretation,
} from "./types";

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
