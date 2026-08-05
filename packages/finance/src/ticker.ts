import type { Brand, Source, Ticker } from "@mapvest/core";
import { searchBrand, toSource } from "@mapvest/search";
import { normalizeBrand, seedBrands } from "./seed.js";

export type TickerResolution = {
  brand: Brand;
  sources: Source[];
};

/**
 * Resolve a brand string to a Brand+Ticker (or a private Brand with no ticker).
 * Cascade: seed table → Exa search + LLM extraction (deferred to caller if needed).
 */
export async function resolveTicker(brandInput: string): Promise<TickerResolution> {
  const key = normalizeBrand(brandInput);
  const seed = seedBrands[key];
  if (seed) {
    const t: Ticker = { symbol: seed.ticker, exchange: seed.exchange, parent: seed.parent };
    return {
      brand: {
        name: brandInput,
        parent: seed.parent,
        isPublic: true,
        ticker: t,
        sector: seed.sector,
      },
      sources: [{ provider: "manual", fetchedAt: new Date().toISOString(), confidence: "high" }],
    };
  }

  // Runtime lookup via Exa. LLM extraction is deferred to the API layer, which
  // already holds the OpenRouter client. This function returns the raw hits;
  // callers decide whether to promote to a ticker.
  let hits: Awaited<ReturnType<typeof searchBrand>> = [];
  try {
    hits = await searchBrand(brandInput);
  } catch (err) {
    console.warn("[finance] exa search failed:", err);
  }

  return {
    brand: { name: brandInput, isPublic: false },
    sources: hits.slice(0, 3).map((h) => toSource(h, "medium")),
  };
}
