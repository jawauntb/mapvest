import type { Comparable, EtfExposure, ResolveComparableResponse } from "./types";

/** Typed ticker in the URL / search field — MCD, BRK.B, not "Starbucks". */
export function looksLikeTicker(s: string): string | undefined {
  const u = s.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.]{0,5}$/.test(u) ? u : undefined;
}

/**
 * Expo Router params are `string | string[]`. decodeURIComponent throws on
 * a malformed percent sequence and would take down Investable before paint.
 */
export function routeParam(id: string | string[] | undefined): string {
  const raw = Array.isArray(id) ? id[0] : id;
  if (typeof raw !== "string" || raw.length === 0) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
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

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * Wire JSON is unvalidated at the fetch boundary. Missing `comparables` /
 * `etfs` / `sources` used to throw in render (`flatMap` on undefined) the
 * moment the loading spinner went away.
 */
export function coerceResolve(
  raw: ResolveComparableResponse | undefined | null,
  name: string,
  ticker?: string,
): ResolveComparableResponse {
  const fb = fallbackResolve(name, ticker);
  if (!raw || typeof raw !== "object") return fb;
  const brand = raw.brand && typeof raw.brand === "object" ? raw.brand : fb.brand;
  const comparables: Comparable[] = asArray<Comparable>(raw.comparables).map((c) => ({
    ...c,
    ticker: typeof c?.ticker === "string" ? c.ticker : "",
    name: typeof c?.name === "string" ? c.name : "",
    score: typeof c?.score === "number" && Number.isFinite(c.score) ? c.score : 0,
    reasoning: typeof c?.reasoning === "string" ? c.reasoning : "",
    sources: asArray(c?.sources),
  }));
  const etfs: EtfExposure[] = asArray<EtfExposure>(raw.etfs).filter(
    (e) => !!e && typeof e.ticker === "string" && !!e.source,
  );
  return {
    brand: {
      name: typeof brand.name === "string" && brand.name.length > 0 ? brand.name : fb.brand.name,
      isPublic: Boolean(brand.isPublic ?? fb.brand.isPublic),
      ticker: brand.ticker ?? fb.brand.ticker,
      sector: brand.sector,
      parent: brand.parent,
      logo: brand.logo,
    },
    comparables,
    etfs,
  };
}
