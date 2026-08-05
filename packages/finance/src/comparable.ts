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

  const seenTickers = new Set<string>();
  const candidates: Comparable[] = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]!;
    const ticker = extractTicker(h.title + " " + (h.snippet ?? ""));
    // Filter junk: no ticker at all, or a duplicate of one we already surfaced.
    if (!ticker) continue;
    if (seenTickers.has(ticker)) continue;
    seenTickers.add(ticker);
    const source: Source = toSource(h, i === 0 ? "medium" : "low");
    candidates.push({
      ticker,
      name: h.title,
      score: Math.max(0.3, 0.9 - candidates.length * 0.15),
      reasoning: (h.snippet ?? "").trim() || `Cited via ${h.url}`,
      sources: [source],
    });
    if (candidates.length >= 3) break;
  }
  return candidates;
}

function extractTicker(text: string): string | null {
  const m = text.match(/\b\(?([A-Z]{1,5})(?::[A-Z]+)?\)?\b/);
  if (!m) return null;
  const sym = m[1];
  // filter obvious noise
  if (["THE", "AND", "FOR", "USA", "CEO"].includes(sym)) return null;
  return sym;
}
