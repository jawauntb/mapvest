import type { EtfExposure, Source } from "@mapvest/core";
import { enrichTicker, toSource } from "@mapvest/search";
import { fallbackEtfsForSector } from "./etf-map.js";
import { normalizeBrand, seedBrands } from "./seed.js";

/**
 * Best-effort ETF exposure discovery for a brand or sector.
 * v0 order:
 *   1. Exa open-web hits for ETF constituent tables (best when available).
 *   2. Fallback: seed-brand sector lookup -> hand-curated sector ETF map.
 * v0.2 will use a dedicated data feed and populate real weights.
 */
export async function resolveEtfExposure(query: string): Promise<EtfExposure[]> {
  let hits: Awaited<ReturnType<typeof enrichTicker>> = [];
  try {
    hits = await enrichTicker(`ETF holdings ${query} constituent weight`);
  } catch {
    hits = [];
  }

  const out: EtfExposure[] = [];
  for (const h of hits.slice(0, 6)) {
    const etfMatch = h.title.match(/\b([A-Z]{2,5})\b/);
    if (!etfMatch) continue;
    out.push({
      ticker: etfMatch[1],
      name: h.title,
      weight: 0, // unknown until a data feed lands
      source: toSource(h, "low"),
    });
  }
  if (out.length > 0) return out;

  // ---- Fallback: seed brand -> sector -> hand-curated ETF map. ----------
  const seed = seedBrands[normalizeBrand(query)];
  const sector = seed?.sector ?? query; // caller may pass a sector name directly
  const fb = fallbackEtfsForSector(sector);
  if (fb.length === 0) return [];

  const manual: Source = {
    provider: "manual",
    fetchedAt: new Date().toISOString(),
    confidence: "medium",
  };
  return fb.map((e) => ({
    ticker: e.ticker,
    name: e.name,
    weight: 0,
    source: manual,
  }));
}
