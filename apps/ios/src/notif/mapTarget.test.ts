import { describe, expect, test } from "bun:test";
import type { NearbyItem } from "@/api/types";
import { matchNotificationMapTarget } from "./mapTarget";

function item(id: string, ticker: string): NearbyItem {
  return {
    place: { id, name: ticker, location: { lat: 40, lng: -74 }, types: [] },
    investable: {
      brand: { name: ticker, isPublic: true, ticker: { symbol: ticker } },
      comparables: [],
      etfs: [],
      confidence: "high",
      sources: [],
    },
  };
}

describe("notification map target matching", () => {
  test("prefers the exact place over another place with the same ticker", () => {
    const items = [item("first", "SBUX"), item("intended", "SBUX")];
    expect(matchNotificationMapTarget(items, { placeId: "intended", ticker: "SBUX" })).toEqual({
      item: items[1]!,
      matchedBy: "placeId",
    });
  });

  test("falls back only to the intended ticker and otherwise reports no match", () => {
    const items = [item("replacement", "JPM")];
    expect(matchNotificationMapTarget(items, { placeId: "stale", ticker: "jpm" })).toEqual({
      item: items[0]!,
      matchedBy: "ticker",
    });
    expect(matchNotificationMapTarget(items, { placeId: "stale", ticker: "NVDA" })).toBeNull();
  });
});
