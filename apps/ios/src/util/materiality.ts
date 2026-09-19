/**
 * Jev materiality tags on headlines — the optional `jev_materiality` field on
 * `/v1/news` and `/v1/watchlist/headlines` items.
 *
 * Two rules from the API contract are load-bearing for every renderer:
 *   1. The tag is ABSENT (not null) when the server could not score the
 *      headline. "Unscored" is not "noise": a "material only" filter keeps
 *      unscored items, so a Jev outage can never empty a feed on the client.
 *   2. Confidence is user-facing — the badge shows level AND percent
 *      ("Material · 82%"), never the level alone.
 */

export const MATERIALITY_LEVELS = ["noise", "minor", "material"] as const;
export type MaterialityLevel = (typeof MATERIALITY_LEVELS)[number];

export type JevMateriality = {
  level: MaterialityLevel;
  /** 0..1 position on the noise→material axis. */
  score: number;
  /** 0..1, always >= 0.55 when present. */
  confidence: number;
};

type Tagged = { jev_materiality?: JevMateriality | null };

/** Defensive read: anything not shaped like a tag is treated as unscored. */
export function materialityOf(item: Tagged | null | undefined): JevMateriality | null {
  const tag = item?.jev_materiality;
  if (!tag || typeof tag !== "object") return null;
  if (!(MATERIALITY_LEVELS as readonly string[]).includes(tag.level)) return null;
  if (typeof tag.confidence !== "number" || !Number.isFinite(tag.confidence)) return null;
  return tag;
}

const LEVEL_LABEL: Record<MaterialityLevel, string> = {
  noise: "Noise",
  minor: "Minor",
  material: "Material",
};

/** `Material · 82%` — the badge copy. */
export function materialityLabel(tag: JevMateriality): string {
  return `${LEVEL_LABEL[tag.level]} · ${Math.round(tag.confidence * 100)}%`;
}

/** Filter predicate for a "material only" toggle: material, or not scored at all. */
export function isMaterialOrUnscored(item: Tagged): boolean {
  const tag = materialityOf(item);
  return tag === null || tag.level === "material";
}

/** Whether a toggle has anything to act on — no tags, no toggle. */
export function hasAnyScored(items: readonly Tagged[]): boolean {
  return items.some((it) => materialityOf(it) !== null);
}
