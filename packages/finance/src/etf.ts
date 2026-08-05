import type { EtfExposure } from "@mapvest/core";
import { enrichTicker, toSource } from "@mapvest/search";

/**
 * Best-effort ETF exposure discovery for a brand or sector.
 * v0: search open web for constituent tables. v0.2 will use a dedicated data feed.
 */
export async function resolveEtfExposure(query: string): Promise<EtfExposure[]> {
  let hits: Awaited<ReturnType<typeof enrichTicker>> = [];
  try {
    hits = await enrichTicker(`ETF holdings ${query} constituent weight`);
  } catch {
    return [];
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
  return out;
}
