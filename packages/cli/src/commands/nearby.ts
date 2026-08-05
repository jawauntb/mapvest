import type { NearbyResponse } from "@mapvest/core";
import { apiBase, printTable, readFlag, readJson } from "../util.js";

/**
 * `mapvest nearby --lat X --lng Y [--radius M] [--limit N]` — GET /v1/nearby
 *
 * Prints a table of place name + ticker (or `—` if the brand isn't
 * publicly investable). Coordinates are required; radius/limit fall back
 * to the API's own defaults when omitted.
 */
export async function runNearby(
  args: string[],
  print: (s: string) => void = console.log,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const lat = readFlag(args, "lat");
  const lng = readFlag(args, "lng");
  if (!lat || !lng) {
    print("usage: mapvest nearby --lat <n> --lng <n> [--radius <m>] [--limit <n>]");
    return 2;
  }
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) {
    print("error: --lat and --lng must be numbers");
    return 2;
  }
  const radius = readFlag(args, "radius");
  const limit = readFlag(args, "limit");

  const qs = new URLSearchParams({ lat: String(nLat), lng: String(nLng) });
  if (radius) qs.set("radius", radius);
  if (limit) qs.set("limit", limit);

  const url = `${apiBase(env)}/v1/nearby?${qs.toString()}`;
  const res = await fetch(url);
  const body = (await readJson(res)) as Partial<NearbyResponse> & { error?: string };

  if (!res.ok) {
    print(`error: ${res.status} ${body.error ?? "nearby failed"}`);
    return 1;
  }
  const items = body.items ?? [];
  if (items.length === 0) {
    print("no nearby places");
    return 0;
  }

  printTable(
    ["place", "ticker", "sector", "public"],
    items.map((it) => {
      const b = it.investable?.brand;
      return [
        it.place.name,
        b?.ticker?.symbol ?? "—",
        b?.sector ?? "—",
        b?.isPublic ? "yes" : "no",
      ];
    }),
    print,
  );
  return 0;
}
