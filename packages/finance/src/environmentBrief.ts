/**
 * Environment-brief helpers (Universe Roadmap §3 C4).
 *
 * Pure query/sector shaping. The API generator still owns FRED/Exa/LLM I/O.
 */
import { canonicalSector } from "./etf-map.js";

/** Canonical GICS sector for a free-form label, or null when unrecognized. */
export function resolveSector(input: string): string | null {
  return canonicalSector(input);
}

/**
 * Two recency-filtered Exa queries. Recency is explicit current/previous year
 * terms in the query text so the Exa wrapper stays a thin shared client.
 */
export function environmentExaQueries(
  sector: string,
  now: Date,
): { bucket: string; query: string }[] {
  const year = now.getUTCFullYear();
  const window = `${year - 1} ${year}`;
  return [
    {
      bucket: "policy",
      query: `${sector} sector policy regulation tariffs legislation outlook ${window}`,
    },
    {
      bucket: "demand",
      query: `${sector} sector demand spending capex order backlog trend ${window}`,
    },
  ];
}
