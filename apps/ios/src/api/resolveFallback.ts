import type { ResolveComparableResponse } from "./types";

/** Typed ticker in the URL / search field — MCD, BRK.B, not "Starbucks". */
export function looksLikeTicker(s: string): string | undefined {
  const u = s.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.]{0,5}$/.test(u) ? u : undefined;
}

/**
 * Minimal identity so Investable can paint when resolve-comparable 429s or
 * 500s. Charts only attach when we already know a ticker.
 */
export function fallbackResolve(name: string, ticker?: string): ResolveComparableResponse {
  return {
    brand: {
      name,
      isPublic: Boolean(ticker),
      ticker: ticker ? { symbol: ticker } : undefined,
    },
    comparables: [],
    etfs: [],
  };
}
