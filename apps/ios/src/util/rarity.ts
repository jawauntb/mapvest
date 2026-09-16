import type { DexRarity, Investable } from "@/api/types";
import { colors } from "@/theme/tokens";

/**
 * Client-side rarity call for a fresh identify result. Mirrors the shape of
 * the server-side classification in `apps/api/src/lib/dex.ts` — but only the
 * cases we can determine without access to the seed table.
 *
 * - Private brand bridged via a comparable → **rare**.
 * - Public brand → we don't distinguish `common` vs `legendary` client-side
 *   (that needs the seed table). Return `null` so the UI omits the chip
 *   rather than mis-labeling a genuinely rare catch as common.
 * - Anything else → `null`.
 *
 * Prefer `resolvedRarity` at render time so a server-stamped field wins.
 */
export type SurfacedRarity = DexRarity;

const RARITY_TIERS: readonly SurfacedRarity[] = ["common", "uncommon", "rare", "legendary"];

function asRarity(value: unknown): SurfacedRarity | null {
  return typeof value === "string" && (RARITY_TIERS as readonly string[]).includes(value)
    ? (value as SurfacedRarity)
    : null;
}

export function rarityFromInvestable(inv: Investable | undefined): SurfacedRarity | null {
  if (!inv) return null;
  const isPrivate = inv.brand.isPublic === false;
  const hasBridge = (inv.comparables?.length ?? 0) > 0;
  if (isPrivate && hasBridge) return "rare";
  return null;
}

/** Server rarity when present; otherwise the client-only rare/null fallback. */
export function resolvedRarity(inv: Investable | undefined): SurfacedRarity | null {
  return asRarity(inv?.rarity) ?? rarityFromInvestable(inv);
}

export function resolvedFindRarity(find: {
  rarity?: string;
  isPublic?: boolean;
  comparable?: string;
}): SurfacedRarity | null {
  const fromServer = asRarity(find.rarity);
  if (fromServer) return fromServer;
  if (find.isPublic === false && (find.comparable?.trim().length ?? 0) > 0) return "rare";
  return null;
}

const RARITY_LABEL: Record<SurfacedRarity, string> = {
  common: "Common catch",
  uncommon: "Uncommon catch",
  rare: "Rare catch",
  legendary: "Legendary catch",
};

export function rarityLabel(r: SurfacedRarity): string {
  return RARITY_LABEL[r];
}

/** Two accents only: jade + signal-blue. Legendary uses the existing warn gold. */
const RARITY_COLOR: Record<SurfacedRarity, string> = {
  common: colors.fgDim,
  uncommon: colors.fgMuted,
  rare: colors.accent2,
  legendary: colors.warn,
};

export function rarityColor(r: SurfacedRarity): string {
  return RARITY_COLOR[r];
}

/**
 * Common is histogram context on /universe only. Rare and legendary always
 * show. Uncommon shows wherever it appears (the server does not emit it yet).
 */
export function shouldShowRarityChip(
  rarity: SurfacedRarity,
  surface: "primary" | "secondary" | "universe",
): boolean {
  if (rarity === "common" && surface !== "universe") return false;
  return true;
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
