/**
 * Counterfactual universe portfolio (Universe Roadmap §1 A3).
 *
 * "If you'd put $100 into every find at the moment you found it, your universe
 * would be worth $X." Pure computation over the finds journal + current quotes;
 * the route (routes/universe.ts) owns the I/O.
 *
 * Exclusion, never estimation (AGENTS.md §2.4 — never fake financial data):
 * a find only contributes when it has a positive `foundPrice` AND a quote for
 * its effective ticker (`ticker ?? comparable`). Everything else is counted in
 * `findCount` but left out of `valuedFinds` / basis / value — we do not guess a
 * price, and we do not silently substitute a peer.
 */
import type { Confidence, Find, Quote, Source, UniverseSummary } from "@mapvest/core";

/** Hypothetical dollars placed into each valued find at the moment it was found. */
export const PER_FIND_BASIS = 100;

/**
 * The symbol a find is valued against: its own ticker when the brand is public,
 * otherwise the closest public comparable recorded at identify time.
 */
export function effectiveTicker(find: Find): string | undefined {
  const symbol = find.ticker ?? find.comparable;
  const trimmed = symbol?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Source confidence derived from the quote's own freshness declaration —
 * never asserted higher than the provider reported (AGENTS.md §6). A quote
 * that declares no freshness gets "low", not a guess.
 */
export function confidenceForFreshness(freshness: Quote["freshness"]): Confidence {
  if (freshness === "real-time") return "high";
  if (freshness === "delayed" || freshness === "end-of-day") return "medium";
  return "low";
}

/**
 * Aggregate the counterfactual portfolio. Pure: no clock beyond `generatedAt`,
 * no network, no store access.
 *
 * @param finds  the caller's finds journal (order irrelevant)
 * @param quotes current quotes keyed by effective ticker
 */
export function computeUniverseSummary(finds: Find[], quotes: Map<string, Quote>): UniverseSummary {
  let valuedFinds = 0;
  let hypotheticalValue = 0;
  // One Source per distinct quote provider actually used, in first-seen order
  // (AGENTS.md §6 — every finance-shaped answer cites where its numbers came
  // from). Keyed by provider so a 200-find universe cites providers, not rows.
  const sources = new Map<string, Source>();

  for (const find of finds) {
    const foundPrice = find.foundPrice;
    if (typeof foundPrice !== "number" || !Number.isFinite(foundPrice) || foundPrice <= 0) {
      continue;
    }
    const symbol = effectiveTicker(find);
    if (!symbol) continue;
    const quote = quotes.get(symbol);
    if (!quote || !Number.isFinite(quote.price)) continue;

    valuedFinds += 1;
    hypotheticalValue += PER_FIND_BASIS * (quote.price / foundPrice);

    // Cite only what the quote actually reported: a quote without a declared
    // provider contributes to the math but adds no citation — a shorter
    // `sources` array beats a fabricated attribution (AGENTS.md §2.4/§6).
    const provider = quote.provider;
    if (provider && !sources.has(provider)) {
      sources.set(provider, {
        provider,
        fetchedAt: quote.ts,
        confidence: confidenceForFreshness(quote.freshness),
      });
    }
  }

  const hypotheticalBasis = PER_FIND_BASIS * valuedFinds;
  const changePct =
    hypotheticalBasis > 0 ? ((hypotheticalValue - hypotheticalBasis) / hypotheticalBasis) * 100 : 0;

  return {
    findCount: finds.length,
    valuedFinds,
    hypotheticalBasis,
    hypotheticalValue,
    changePct,
    generatedAt: new Date().toISOString(),
    sources: [...sources.values()],
  };
}
