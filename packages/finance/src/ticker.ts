import type { Brand, Source, Ticker } from "@mapvest/core";
import { searchBrand, toSource } from "@mapvest/search";
import { normalizeBrand, normalizeParent } from "./normalize.js";
import { seedBrands, type SeedEntry } from "./seed.js";

export type TickerResolution = {
  brand: Brand;
  sources: Source[];
};

function toResolution(brandInput: string, seed: SeedEntry): TickerResolution {
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

/**
 * Resolve a brand string to a Brand+Ticker (or a private Brand with no ticker).
 * Cascade:
 *   1. Direct seed-key lookup (fast path — matches brand short-forms).
 *   2. Parent-name fallback — when Gemini returns "The Hershey Company"
 *      instead of "Hershey's", scan seed values for a parent whose
 *      `normalizeParent` form matches the input's. Seed key still wins
 *      when both would match, so brand-short-forms are preferred.
 *   3. Exa search + LLM extraction (deferred to caller if needed).
 */
export async function resolveTicker(brandInput: string): Promise<TickerResolution> {
  // (1) direct seed-key match
  const key = normalizeBrand(brandInput);
  const seed = seedBrands[key];
  if (seed) return toResolution(brandInput, seed);

  // (2) parent-name fallback — only reached when the direct lookup missed.
  // We compare parent-normalized forms so "The Hershey Company", "Hershey Co",
  // and "Hershey, Inc." all resolve to the same row Gemini's brand short-form
  // would have hit. Empty normalization (e.g. input was just "The") is skipped
  // to avoid a spurious match on any parent that also strips to "".
  const parentKey = normalizeParent(brandInput);
  if (parentKey) {
    for (const entry of Object.values(seedBrands)) {
      if (normalizeParent(entry.parent) === parentKey) {
        return toResolution(brandInput, entry);
      }
    }
  }

  // (3) Runtime lookup via Exa. LLM extraction is deferred to the API layer,
  // which already holds the OpenRouter client. This function returns the raw
  // hits; callers decide whether to promote to a ticker.
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
