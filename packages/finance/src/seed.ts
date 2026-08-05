/**
 * Seed brand -> ticker map. Loaded from data/brands.json (add-only).
 * When adding, include a source URL in the commit message.
 *
 * Bun natively supports JSON imports; TypeScript resolves via resolveJsonModule.
 * We keep an "import assertions" style hint (`with { type: "json" }`) for
 * runtimes that require it. Bun accepts either form.
 */

import brandsData from "../data/brands.json" with { type: "json" };

// `normalizeBrand` lives in ./normalize.ts alongside `normalizeParent` so
// the two share one place to reason about string folding. Re-exported
// here for back-compat with existing importers of "@mapvest/finance/seed".
export { normalizeBrand } from "./normalize.js";

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
