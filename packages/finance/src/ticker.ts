import type { Brand, Source, Ticker } from "@mapvest/core";
import { searchBrand, toSource } from "@mapvest/search";
import { normalizeBrand, normalizeParent } from "./normalize.js";
import { getQuote } from "./quote.js";
import { seedBrands, type SeedEntry } from "./seed.js";

const TICKER_RE = /^[A-Z][A-Z0-9.]{0,5}$/;

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
 * Longest seed-key substring match — so Places names like
 * "Super 8 by Wyndham Long Island City LGA Hotel" still hit `super 8` / `wyndham`.
 * Keys shorter than 4 chars are skipped to avoid spurious hits ("gap", "bp").
 */
function matchSeedSubstring(normalized: string): SeedEntry | undefined {
  let bestKey = "";
  let best: SeedEntry | undefined;
  for (const [key, entry] of Object.entries(seedBrands)) {
    if (key.length < 4) continue;
    if (!normalized.includes(key)) continue;
    if (key.length > bestKey.length) {
      bestKey = key;
      best = entry;
    }
  }
  return best;
}

/**
 * Resolve a brand string to a Brand+Ticker (or a private Brand with no ticker).
 * Cascade:
 *   1. Direct seed-key lookup (fast path — matches brand short-forms).
 *   2. Substring seed match for long Places display names.
 *   3. Parent-name fallback — when Gemini returns "The Hershey Company"
 *      instead of "Hershey's", scan seed values for a parent whose
 *      `normalizeParent` form matches the input's. Seed key still wins
 *      when both would match, so brand-short-forms are preferred.
 *   4. Ticker-shaped input + Yahoo quote hit → listed.
 *   5. Exa search + LLM extraction (deferred to caller if needed).
 */
export async function resolveTicker(brandInput: string): Promise<TickerResolution> {
  // (1) direct seed-key match
  const key = normalizeBrand(brandInput);
  const seed = seedBrands[key];
  if (seed) return toResolution(brandInput, seed);

  // (2) substring seed match (Places "Brand + location" titles)
  const sub = matchSeedSubstring(key);
  if (sub) return toResolution(brandInput, sub);

  // (3) parent-name fallback — only reached when the direct lookup missed.
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

  // (4) Ticker-shaped input with a live Yahoo quote → listed, not private.
  // This is how /detail/RLX stops being labeled "private" when the chart works.
  const asTicker = brandInput.trim().toUpperCase();
  if (TICKER_RE.test(asTicker)) {
    const quote = await getQuote(asTicker);
    if (quote) {
      return {
        brand: {
          name: quote.name ?? brandInput,
          isPublic: true,
          ticker: { symbol: quote.symbol },
        },
        sources: [
          {
            provider: "yahoo",
            url: `https://finance.yahoo.com/quote/${encodeURIComponent(quote.symbol)}`,
            fetchedAt: quote.ts,
            confidence: "high",
          },
        ],
      };
    }
  }

  // (5) Runtime lookup via Exa. LLM extraction is deferred to the API layer,
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
