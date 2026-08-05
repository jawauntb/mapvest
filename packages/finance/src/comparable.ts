import type { Comparable, Source } from "@mapvest/core";
import { searchBrand, toSource } from "@mapvest/search";

/**
 * Given a private brand name, return public comparables ranked by score.
 * Sector inference lives in a follow-up patch; v0 uses Exa hits + a coarse heuristic.
 */
export async function resolveComparable(brand: string, hintSector?: string): Promise<Comparable[]> {
  let hits: Awaited<ReturnType<typeof searchBrand>> = [];
  try {
    hits = await searchBrand(
      `${brand} closest public competitor ${hintSector ?? ""} stock ticker`,
    );
  } catch {
    return [];
  }

  return hits.slice(0, 5).map((h, i) => {
    const source: Source = toSource(h, i === 0 ? "medium" : "low");
    return {
      ticker: extractTicker(h.title + " " + (h.snippet ?? "")) ?? "UNKNOWN",
      name: h.title,
      score: Math.max(0.2, 0.9 - i * 0.15),
      reasoning: h.snippet ?? "Exa snippet not available",
      sources: [source],
    } satisfies Comparable;
  });
}

function extractTicker(text: string): string | null {
  const m = text.match(/\b\(?([A-Z]{1,5})(?::[A-Z]+)?\)?\b/);
  if (!m) return null;
  const sym = m[1];
  // filter obvious noise
  if (["THE", "AND", "FOR", "USA", "CEO"].includes(sym)) return null;
  return sym;
}
