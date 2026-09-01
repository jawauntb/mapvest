import type { NearbyItem } from "@/api/types";

export type NotificationMapTarget = { placeId?: string; ticker?: string };

export type NotificationMapTargetMatch = {
  item: NearbyItem;
  matchedBy: "placeId" | "ticker";
};

function itemTickers(item: NearbyItem): string[] {
  const own = item.investable?.brand.ticker?.symbol;
  const comparables = item.investable?.comparables.map((comparable) => comparable.ticker) ?? [];
  return [own, ...comparables]
    .filter((ticker): ticker is string => typeof ticker === "string")
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean);
}

/** Preserve notification intent: exact place first, then its cited ticker. */
export function matchNotificationMapTarget(
  items: NearbyItem[],
  target: NotificationMapTarget,
): NotificationMapTargetMatch | null {
  if (target.placeId) {
    const exact = items.find((item) => item.place.id === target.placeId);
    if (exact) return { item: exact, matchedBy: "placeId" };
  }
  const ticker = target.ticker?.trim().toUpperCase();
  if (!ticker) return null;
  const byTicker = items.find((item) => itemTickers(item).includes(ticker));
  return byTicker ? { item: byTicker, matchedBy: "ticker" } : null;
}
