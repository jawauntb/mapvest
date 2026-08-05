/**
 * Hand-curated sector -> top-3 ETFs map used as a fallback for the ETF resolver
 * when open-web search returns nothing usable.
 *
 * The list intentionally sticks to the largest, most liquid US-listed sector
 * ETFs so the fallback is safe to hand back to end-users. Weights are unknown
 * from this table — callers should treat `weight: 0` as "not provided".
 *
 * GICS sector names (matching packages/core Brand.sector) are the primary keys.
 * A few common aliases are supplied for convenience.
 */

export type EtfMapEntry = {
  ticker: string;
  name: string;
};

/** GICS sector -> top-3 ETFs. Order is deliberate: SPDR sector first,
 *  Vanguard sector second, iShares/Fidelity third. */
export const sectorEtfMap: Record<string, EtfMapEntry[]> = {
  "Consumer Staples": [
    { ticker: "XLP", name: "Consumer Staples Select Sector SPDR Fund" },
    { ticker: "VDC", name: "Vanguard Consumer Staples ETF" },
    { ticker: "IYK", name: "iShares U.S. Consumer Staples ETF" },
  ],
  "Consumer Discretionary": [
    { ticker: "XLY", name: "Consumer Discretionary Select Sector SPDR Fund" },
    { ticker: "VCR", name: "Vanguard Consumer Discretionary ETF" },
    { ticker: "FDIS", name: "Fidelity MSCI Consumer Discretionary Index ETF" },
  ],
  Energy: [
    { ticker: "XLE", name: "Energy Select Sector SPDR Fund" },
    { ticker: "VDE", name: "Vanguard Energy ETF" },
    { ticker: "IYE", name: "iShares U.S. Energy ETF" },
  ],
  Financials: [
    { ticker: "XLF", name: "Financial Select Sector SPDR Fund" },
    { ticker: "VFH", name: "Vanguard Financials ETF" },
    { ticker: "IYF", name: "iShares U.S. Financials ETF" },
  ],
  "Health Care": [
    { ticker: "XLV", name: "Health Care Select Sector SPDR Fund" },
    { ticker: "VHT", name: "Vanguard Health Care ETF" },
    { ticker: "IYH", name: "iShares U.S. Healthcare ETF" },
  ],
  Industrials: [
    { ticker: "XLI", name: "Industrial Select Sector SPDR Fund" },
    { ticker: "VIS", name: "Vanguard Industrials ETF" },
    { ticker: "IYJ", name: "iShares U.S. Industrials ETF" },
  ],
  "Information Technology": [
    { ticker: "XLK", name: "Technology Select Sector SPDR Fund" },
    { ticker: "VGT", name: "Vanguard Information Technology ETF" },
    { ticker: "IYW", name: "iShares U.S. Technology ETF" },
  ],
  Materials: [
    { ticker: "XLB", name: "Materials Select Sector SPDR Fund" },
    { ticker: "VAW", name: "Vanguard Materials ETF" },
    { ticker: "IYM", name: "iShares U.S. Basic Materials ETF" },
  ],
  "Communication Services": [
    { ticker: "XLC", name: "Communication Services Select Sector SPDR Fund" },
    { ticker: "VOX", name: "Vanguard Communication Services ETF" },
    { ticker: "FCOM", name: "Fidelity MSCI Communication Services Index ETF" },
  ],
  "Real Estate": [
    { ticker: "XLRE", name: "Real Estate Select Sector SPDR Fund" },
    { ticker: "VNQ", name: "Vanguard Real Estate ETF" },
    { ticker: "IYR", name: "iShares U.S. Real Estate ETF" },
  ],
  Utilities: [
    { ticker: "XLU", name: "Utilities Select Sector SPDR Fund" },
    { ticker: "VPU", name: "Vanguard Utilities ETF" },
    { ticker: "IDU", name: "iShares U.S. Utilities ETF" },
  ],
};

/** Human-typed aliases we've seen in the wild. Keys normalized to lowercase. */
const sectorAliases: Record<string, string> = {
  tech: "Information Technology",
  technology: "Information Technology",
  it: "Information Technology",
  "info tech": "Information Technology",
  staples: "Consumer Staples",
  "consumer defensive": "Consumer Staples",
  discretionary: "Consumer Discretionary",
  "consumer cyclical": "Consumer Discretionary",
  finance: "Financials",
  financial: "Financials",
  banks: "Financials",
  health: "Health Care",
  healthcare: "Health Care",
  "health care": "Health Care",
  pharma: "Health Care",
  industrial: "Industrials",
  transports: "Industrials",
  materials: "Materials",
  chemicals: "Materials",
  metals: "Materials",
  reit: "Real Estate",
  reits: "Real Estate",
  "real estate": "Real Estate",
  utility: "Utilities",
  utilities: "Utilities",
  telecom: "Communication Services",
  telecommunications: "Communication Services",
  media: "Communication Services",
  comm: "Communication Services",
  "comm services": "Communication Services",
  energy: "Energy",
  oil: "Energy",
  "oil & gas": "Energy",
};

/**
 * Resolve a free-form sector label to the canonical GICS name, or null if we
 * do not have a match. Case-insensitive; alias-aware.
 */
export function canonicalSector(input: string | undefined | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (sectorEtfMap[trimmed]) return trimmed;
  const lower = trimmed.toLowerCase();
  // exact-canonical hit under a case-insensitive comparison
  for (const canon of Object.keys(sectorEtfMap)) {
    if (canon.toLowerCase() === lower) return canon;
  }
  const alias = sectorAliases[lower];
  return alias ?? null;
}

/**
 * Return the fallback ETF list for a sector, or an empty array if we do not
 * recognize the sector. Callers can decide how to attach `Source` metadata.
 */
export function fallbackEtfsForSector(sector: string | undefined | null): EtfMapEntry[] {
  const canon = canonicalSector(sector);
  if (!canon) return [];
  return sectorEtfMap[canon] ?? [];
}
