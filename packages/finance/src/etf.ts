import type { EtfExposure, Source } from "@mapvest/core";
import { enrichTicker, toSource } from "@mapvest/search";
import { fallbackEtfsForSector } from "./etf-map.js";
import { normalizeBrand, seedBrands } from "./seed.js";
import { extractListedTicker, isPlausibleTicker } from "./tickerSymbol.js";

/** Well-known sector / thematic ETF tickers we accept from web hits. */
const KNOWN_ETF = new Set([
  "XLP",
  "VDC",
  "IYK",
  "XLY",
  "VCR",
  "XLF",
  "XLE",
  "XLI",
  "XLB",
  "XLK",
  "VGT",
  "IYW",
  "XLV",
  "XLU",
  "XLRE",
  "XLC",
  "SPY",
  "VOO",
  "QQQ",
  "IWM",
  "DIA",
  "ARKK",
  "IBB",
  "KWEB",
  "EEM",
  "VTI",
  "ITB",
  "XRT",
  "PEJ",
  "JETS",
]);

/**
 * Best-effort ETF exposure discovery for a brand or sector.
 * v0 order:
 *   1. Exa open-web hits for ETF constituent tables (best when available).
 *   2. Fallback: seed-brand sector lookup -> hand-curated sector ETF map.
 * Never invents tickers from random ALLCAPS tokens in page titles.
 */
export async function resolveEtfExposure(query: string): Promise<EtfExposure[]> {
  let hits: Awaited<ReturnType<typeof enrichTicker>> = [];
  try {
    hits = await enrichTicker(`ETF holdings ${query} constituent weight ticker`);
  } catch {
    hits = [];
  }

  const out: EtfExposure[] = [];
  const seen = new Set<string>();
  for (const h of hits.slice(0, 8)) {
    const text = `${h.title} ${h.snippet ?? ""}`;
    const listed = extractListedTicker(text);
    const candidate = listed ?? text.match(/\b([A-Z]{2,5})\b/)?.[1];
    if (!candidate || !isPlausibleTicker(candidate)) continue;
    // Accept only known ETF symbols OR strict listed citations.
    if (!listed && !KNOWN_ETF.has(candidate)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push({
      ticker: candidate,
      name: h.title,
      weight: 0, // unknown until a data feed lands
      source: toSource(h, listed ? "medium" : "low"),
    });
    if (out.length >= 3) break;
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
