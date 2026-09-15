import type { Investable } from "@/api/types";

/**
 * Client-side rarity call for a fresh identify result. Mirrors the shape of
 * the server-side classification in `apps/api/src/lib/dex.ts` — but only the
 * cases we can determine without access to the seed table.
 *
 * - Private brand bridged via a comparable → **rare**. This is the case v2
 *   of the World Bible names as "already tagged rare on the server; surface
 *   it at the moment of the catch." Confirmed cheaply from `isPublic` +
 *   presence of a comparable.
 * - Public brand → we don't distinguish `common` vs `legendary` client-side
 *   (that needs the seed table). Return `null` so the UI omits the chip
 *   rather than mis-labeling a genuinely rare catch as common.
 * - Anything else → `null`.
 */
export type SurfacedRarity = "rare";

export function rarityFromInvestable(inv: Investable | undefined): SurfacedRarity | null {
  if (!inv) return null;
  const isPrivate = inv.brand.isPublic === false;
  const hasBridge = (inv.comparables?.length ?? 0) > 0;
  if (isPrivate && hasBridge) return "rare";
  return null;
}

const RARITY_LABEL: Record<SurfacedRarity, string> = {
  rare: "Rare catch",
};

export function rarityLabel(r: SurfacedRarity): string {
  return RARITY_LABEL[r];
}

/**
 * Neutral human-readable source count for a result. "Evidence · N" when the
 * server returned any citations; "⚠ No citations" otherwise. Kept short so
 * it fits on a compact secondary row.
 */
export function evidenceChipLabel(sourceCount: number): string {
  if (sourceCount <= 0) return "No citations";
  return `Evidence · ${sourceCount}`;
}
