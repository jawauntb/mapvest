/**
 * Seed brand -> ticker map. Loaded from data/brands.json (add-only).
 * When adding, include a source URL in the commit message.
 *
 * Bun natively supports JSON imports; TypeScript resolves via resolveJsonModule.
 * We keep an "import assertions" style hint (`with { type: "json" }`) for
 * runtimes that require it. Bun accepts either form.
 */

import brandsData from "../data/brands.json" with { type: "json" };

export type SeedEntry = {
  ticker: string;
  exchange: string;
  parent: string;
  sector?: string;
  isPublic: true;
};

// The JSON file's literal `true` widens to `boolean` on import; re-narrow via cast.
export const seedBrands: Record<string, SeedEntry> = brandsData as unknown as Record<
  string,
  SeedEntry
>;

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
