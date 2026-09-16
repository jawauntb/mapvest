import type { Confidence, DexRarity } from "@/api/types";

export const GUEST_FINDS_STORAGE_KEY = "mapvest.guestFinds.v1";
export const GUEST_LAST_FIND_AT_KEY = "mapvest.guestLastFindAt.v1";
export const GUEST_JOURNAL_CAP = 50;

export type GuestFindDraft = {
  brand: string;
  ticker?: string;
  isPublic?: boolean;
  comparable?: string;
  confidence: Confidence;
  lat?: number;
  lng?: number;
  foundPrice?: number;
  createdAt: string;
  rarity?: DexRarity;
};

function findIdentityKey(find: Pick<GuestFindDraft, "brand" | "ticker" | "comparable">): string {
  const symbol = (find.ticker ?? find.comparable ?? "").trim().toUpperCase();
  return symbol || find.brand.trim().toUpperCase();
}

export type GuestFindSource = {
  brand: { name: string; isPublic: boolean; ticker?: { symbol?: string } };
  comparables?: { ticker: string }[];
  confidence: Confidence;
  rarity?: DexRarity;
  quote?: { price?: number };
};

/** Shape a camera Investable into the guest journal row (mirrors identify → recordFind). */
export function guestFindFromInvestable(
  inv: GuestFindSource,
  extras: { lat?: number; lng?: number; foundPrice?: number; createdAt?: string } = {},
): GuestFindDraft {
  const isPublic = inv.brand.isPublic;
  const foundPrice = extras.foundPrice ?? inv.quote?.price;
  return {
    brand: inv.brand.name,
    ticker: isPublic ? inv.brand.ticker?.symbol : undefined,
    isPublic,
    comparable: isPublic ? undefined : inv.comparables?.[0]?.ticker,
    confidence: inv.confidence,
    lat: extras.lat,
    lng: extras.lng,
    foundPrice,
    createdAt: extras.createdAt ?? new Date().toISOString(),
    rarity: inv.rarity,
  };
}

/** Newest-first, first catch per identity wins — same as server `recordFind`. */
export function mergeGuestFind(existing: GuestFindDraft[], next: GuestFindDraft): GuestFindDraft[] {
  const key = findIdentityKey(next);
  if (!key) return existing;
  if (existing.some((row) => findIdentityKey(row) === key)) return existing;
  return [next, ...existing].slice(0, GUEST_JOURNAL_CAP);
}

export function parseGuestJournal(raw: string | null): GuestFindDraft[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isGuestFindDraft).slice(0, GUEST_JOURNAL_CAP);
  } catch {
    return [];
  }
}

function isGuestFindDraft(value: unknown): value is GuestFindDraft {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.brand === "string" && typeof row.confidence === "string";
}

/** Strip client-only fields before POST /v1/finds. */
export function toRecordFindInput(find: GuestFindDraft): {
  brand: string;
  ticker?: string;
  isPublic?: boolean;
  comparable?: string;
  confidence: Confidence;
  lat?: number;
  lng?: number;
  foundPrice?: number;
  createdAt: string;
} {
  return {
    brand: find.brand,
    ticker: find.ticker,
    isPublic: find.isPublic,
    comparable: find.comparable,
    confidence: find.confidence,
    lat: find.lat,
    lng: find.lng,
    foundPrice: find.foundPrice,
    createdAt: find.createdAt,
  };
}
