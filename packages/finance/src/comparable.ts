import type { Comparable, Source } from "@mapvest/core";
import { searchBrand, toSource } from "@mapvest/search";
import { extractListedTicker } from "./tickerSymbol.js";

/**
 * Given a private brand name, return public comparables ranked by score.
 * Sector inference lives in a follow-up patch; v0 uses Exa hits + a coarse heuristic.
 *
 * Only emits symbols that look like real exchange citations ($MCD, NYSE: MCD).
 * Never invents tickers from title abbreviations (NYP, MOUNT, MSHS).
 */
export async function resolveComparable(brand: string, hintSector?: string): Promise<Comparable[]> {
  let hits: Awaited<ReturnType<typeof searchBrand>> = [];
  try {
    hits = await searchBrand(
      `${brand} closest public competitor ${hintSector ?? ""} stock ticker NYSE NASDAQ`,
    );
  } catch {
    return [];
  }

  const seenTickers = new Set<string>();
  const candidates: Comparable[] = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]!;
    const ticker = extractListedTicker(`${h.title} ${h.snippet ?? ""}`);
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
