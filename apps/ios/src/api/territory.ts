import type { FetchOpts } from "./http";
import type { TerritoryResponse } from "./types";

export type { TerritoryResponse };

/**
 * Tile completion + co-op raid state for the geohash-6 cell containing
 * lat/lng (Universe Roadmap §4 Item 4 — co-op tile uncover, "the weekly
 * raid"). Bearer-required. `coop` is shared, per-tile state: it reads the
 * same for anyone viewing this tile, contributor or not.
 */
export async function fetchTerritory(
  args: { lat: number; lng: number },
  opts: FetchOpts = {},
): Promise<TerritoryResponse> {
  // Deferred import: `./http` pulls in expo-secure-store transitively, so a
  // plain schema-parse test never needs the native module chain (mirrors
  // `./leaderboard.ts` / `./handles.ts`).
  const { apiFetch } = await import("./http");
  const params = new URLSearchParams({ lat: String(args.lat), lng: String(args.lng) });
  return apiFetch(`/v1/territory?${params.toString()}`, { method: "GET" }, opts);
}
