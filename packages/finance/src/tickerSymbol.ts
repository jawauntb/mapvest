/**
 * Shared ticker-symbol extraction / validation.
 * Never invent symbols from random ALLCAPS tokens in web titles
 * (that produced fake "NYP", "MOUNT", "MSHS" for nonprofits).
 */

const DENY = new Set([
  "THE",
  "AND",
  "FOR",
  "USA",
  "CEO",
  "CFO",
  "CTO",
  "IPO",
  "ETF",
  "ETFS",
  "SEC",
  "IRS",
  "LLC",
  "INC",
  "CORP",
  "LTD",
  "PLC",
  "CO",
  "NY",
  "LA",
  "SF",
  "DC",
  "MD",
  "DR",
  "US",
  "UK",
  "EU",
  "AI",
  "API",
  "PDF",
  "HTTP",
  "HTTPS",
  "WWW",
  "COM",
  "ORG",
  "NET",
  "NYP",
  "MSHS",
  "MOUNT",
  "PLAN",
  "DATA",
  "INFO",
  "GUIDE",
  "PROFILE",
  "CAUSE",
  "OWLER",
  "YAHOO",
  "GOOGLE",
  "WIKI",
]);

/** Strict patterns that indicate a real listed ticker citation. */
const STRICT_PATTERNS: RegExp[] = [
  /\$([A-Z]{1,5})\b/,
  /\b(?:NYSE|NASDAQ|AMEX|NYSEARCA|BATS)\s*:\s*([A-Z]{1,5})\b/i,
  /\(\s*(?:NYSE|NASDAQ|AMEX)\s*:\s*([A-Z]{1,5})\s*\)/i,
  /\bticker\s*[:#]?\s*([A-Z]{1,5})\b/i,
  /\b(?:symbol|traded as)\s*[:#]?\s*([A-Z]{1,5})\b/i,
];

export function isPlausibleTicker(sym: string): boolean {
  if (!/^[A-Z]{1,5}$/.test(sym)) return false;
  if (DENY.has(sym)) return false;
  return true;
}

/**
 * Extract a ticker only when the text cites it as a market symbol.
 * Returns null rather than guessing from title abbreviations.
 */
export function extractListedTicker(text: string): string | null {
  for (const re of STRICT_PATTERNS) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const sym = m[1].toUpperCase();
    if (isPlausibleTicker(sym)) return sym;
  }
  return null;
}
