/**
 * Brand and parent-company string normalization for seed lookups.
 *
 * `normalizeBrand` (moved from seed.ts) is the canonical form for direct
 * seed keys — lowercased, trimmed, curly apostrophes folded to straight,
 * runs of whitespace collapsed.
 *
 * `normalizeParent` is a looser form used as a fallback when a caller
 * (e.g., Gemini) hands us a parent-company name instead of a brand
 * short-form. It layers on top of `normalizeBrand`:
 *   - strips a leading "the " prefix
 *   - iteratively strips trailing corporate suffixes (Co, Inc, Corp,
 *     Company, Corporation, Group, Holdings, Ltd, PLC, AG, SA, S.A.)
 *   - tolerates trailing commas/periods around those suffixes (so
 *     "Hershey, Inc." reduces just like "Hershey Inc").
 *
 * Both sides of a comparison must be run through `normalizeParent` for
 * the match to be symmetric.
 */

/** Normalize a brand string to the seed key form.
 *  - trims outer whitespace
 *  - lowercases
 *  - normalizes curly apostrophes (', ') to straight (')
 *  - collapses runs of internal whitespace to a single space
 */
export function normalizeBrand(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, " ");
}

// Order matters when a suffix is a prefix of another: check the longer
// form first so " corporation" doesn't lose only " corp".
const PARENT_SUFFIXES = [
  " corporation",
  " company",
  " holdings",
  " group",
  " s.a.",
  " corp",
  " inc",
  " ltd",
  " plc",
  " ag",
  " sa",
  " co",
] as const;

/**
 * Normalize a parent-company name for equivalence comparison with
 * `normalizeBrand`-style keys. Callers should apply it to BOTH sides of
 * the comparison.
 *
 * Examples (all → "hershey"):
 *   "The Hershey Company"
 *   "Hershey Co"
 *   "Hershey Company Inc"
 *   "Hershey, Inc."
 */
export function normalizeParent(input: string): string {
  let s = normalizeBrand(input);

  // Strip "the " prefix once — corporate names use it as a formality
  // ("The Coca-Cola Co"), never as content.
  if (s.startsWith("the ")) s = s.slice(4).trim();

  // Iteratively peel trailing corporate suffixes plus any punctuation
  // that decorates them ("Hershey, Inc." → "hershey, inc" → "hershey," → "hershey").
  //
  // Try a suffix match on the raw string first: some suffixes carry their
  // own punctuation (" s.a."), and stripping trailing dots too eagerly
  // would erase them. Only if no suffix matches do we peel one round of
  // trailing whitespace/comma/period and try again.
  let changed = true;
  while (changed) {
    changed = false;

    for (const suf of PARENT_SUFFIXES) {
      if (s.endsWith(suf)) {
        s = s.slice(0, -suf.length);
        changed = true;
        break;
      }
    }
    if (changed) continue;

    const trimmed = s.replace(/[\s.,]+$/, "");
    if (trimmed !== s) {
      s = trimmed;
      changed = true;
    }
  }

  return s.trim();
}
