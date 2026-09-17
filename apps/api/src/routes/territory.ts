/**
 * Territory — geohash-6 tile completion + pioneer status
 * (Universe Roadmap §1 A6).
 *
 * Routes (bearer-required):
 *   GET /?lat=&lng= → TerritoryResponse { tile, investablesTotal, found, pioneer, sources }
 *
 * Mounted by the integrator at /v1/territory.
 *
 * Derived on read, like the dex and the quest board: nothing about a tile is
 * persisted. The denominator is the nearby cascade run from the TILE'S CENTRE
 * (not the caller's exact position), so two users standing on opposite corners
 * of the same block see the same "6 of 11" — a tile is a property of the map,
 * not of where you happen to be holding the phone. The numerator is the
 * caller's own journal intersected with that list.
 *
 * The pioneer XP is NOT granted here. It is granted at write time in
 * `recordFind` under the idempotent grant key `pioneer:{tile}`, so a user who
 * never opens this screen still earns it and opening it twice never pays
 * twice. This route only reports whether they are still the first here.
 *
 * `sources` are the real provider citations the brand→ticker join already
 * carries (AGENTS.md §6). An uncitable tile returns FEWER sources — never an
 * invented one.
 */
import type { Source, TerritoryResponse } from "@mapvest/core";
import { Hono } from "hono";
import { findsInTile, listDistinctEffectiveTickers } from "../lib/finds-store.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { resolveNearbyItems } from "../lib/nearby-resolve.js";
import { TILE_RADIUS_M, completion, isPioneer, tileCenter, tileFor } from "../lib/territory.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

/** How many places the tile lookup asks the cascade for. */
const TILE_PLACES_LIMIT = 50;

/** Keep the citation list readable — the join repeats the same few providers. */
const MAX_SOURCES = 8;

/** Dedupe citations by provider+url, preserving first-seen order. */
function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const source of sources) {
    const key = `${source.provider}|${source.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

const territory = new Hono<AuthEnv>();
territory.use("*", bearerAuth);

territory.get("/", async (c) => {
  return safeExecuteWithSpan("http.territory.get", async (span) => {
    const user = c.get("user");
    const lat = Number(c.req.query("lat"));
    const lng = Number(c.req.query("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      span.setAttribute("error.kind", "bad_coords");
      return c.json({ error: "lat/lng required" }, 400);
    }

    const tile = tileFor(lat, lng);
    // `tileFor` always produces a decodable geohash; the fallback is defensive.
    const center = tileCenter(tile) ?? { lat, lng };
    span.setAttributes({ user_id: user.id, tile, lat, lng });

    let items: Awaited<ReturnType<typeof resolveNearbyItems>>["items"];
    try {
      ({ items } = await resolveNearbyItems({
        lat: center.lat,
        lng: center.lng,
        radius: TILE_RADIUS_M,
        limit: TILE_PLACES_LIMIT,
        span,
      }));
    } catch (err) {
      const message = (err as Error).message;
      // Bad MOCK_PLACES config is a deploy/dev mistake, not an upstream
      // outage — mirrors `/v1/nearby`.
      const status = message.startsWith("MOCK_PLACES") ? 500 : 502;
      return c.json({ error: message }, status);
    }

    // The denominator: distinct public tickers the cascade resolved in the tile.
    const investableTickers: string[] = [];
    const sources: Source[] = [];
    for (const item of items) {
      const investable = item.investable;
      if (!investable) continue;
      const symbol = investable.brand.ticker?.symbol;
      if (symbol) investableTickers.push(symbol);
      sources.push(...investable.sources);
    }

    const [journalTickers, tileFinds] = await Promise.all([
      listDistinctEffectiveTickers(user.id),
      findsInTile(user.id, tile),
    ]);

    const { investablesTotal, found } = completion(investableTickers, journalTickers);
    const pioneer = isPioneer(tile, tileFinds);

    span.setAttributes({
      investables_total: investablesTotal,
      found,
      pioneer,
      tile_finds: tileFinds.length,
      sources_count: Math.min(sources.length, MAX_SOURCES),
    });

    const resp: TerritoryResponse = {
      tile,
      investablesTotal,
      found,
      pioneer,
      sources: dedupeSources(sources),
    };
    // Same cache posture as `/v1/nearby`: the places + brand join behind the
    // denominator moves on the order of hours, but `found`/`pioneer` are
    // per-user, so this must never be cached by a shared CDN.
    c.header("Cache-Control", "private, max-age=60");
    return c.json(resp);
  });
});

export default territory;
