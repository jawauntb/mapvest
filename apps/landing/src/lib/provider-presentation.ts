const MARKET_DATA_LABEL = "Market data";
const MARKET_DATA_SOURCE_LABEL = "Market data source";

const BRANDED_PROVIDER_TOKENS = new Map([
  ["massive", MARKET_DATA_LABEL],
  ["massive.com", MARKET_DATA_SOURCE_LABEL],
  ["api.massive.com", MARKET_DATA_SOURCE_LABEL],
  ["polygon", MARKET_DATA_LABEL],
  ["polygon.io", MARKET_DATA_SOURCE_LABEL],
  ["api.polygon.io", MARKET_DATA_SOURCE_LABEL],
]);

const BRANDED_PROVIDER_LABELS = new Map([
  ["massive market data", MARKET_DATA_LABEL],
  ["massive api", MARKET_DATA_LABEL],
  ["polygon market data", MARKET_DATA_LABEL],
  ["polygon api", MARKET_DATA_LABEL],
  ["massive news", "Market news"],
  ["polygon news", "Market news"],
]);

const BRANDED_FRESHNESS_DISCLAIMER =
  /^(real-time|delayed|end-of-day|delayed by 15 min), source: (?:massive|polygon(?:\.io)?)$/i;
const BRANDED_SUBSCRIPTION_DISCLAIMER =
  /^freshness depends on (?:massive|polygon(?:\.io)?) subscription, source: (?:massive|polygon(?:\.io)?)$/i;

/**
 * Neutralizes provider names only when an entire presentation label is known
 * to be provider metadata. Free-form article and research prose stays intact.
 */
export function providerPresentationLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  const knownToken = BRANDED_PROVIDER_TOKENS.get(normalized);
  if (knownToken) return knownToken;

  const knownLabel = BRANDED_PROVIDER_LABELS.get(normalized);
  if (knownLabel) return knownLabel;

  const freshness = value.trim().match(BRANDED_FRESHNESS_DISCLAIMER);
  if (freshness?.[1]) return `${freshness[1].toLowerCase()}, source: ${MARKET_DATA_LABEL}`;

  if (BRANDED_SUBSCRIPTION_DISCLAIMER.test(value.trim())) {
    return "freshness depends on market data availability";
  }

  // Tool names are identifier-shaped metadata, not article prose. Replace an
  // exact provider segment while leaving ordinary sentences untouched.
  if (/^[a-z0-9_.:/-]+$/i.test(value)) {
    const segments = value.split(/([_.:/-]+)/);
    if (segments.some((segment) => /^(?:massive|polygon)$/i.test(segment))) {
      return segments
        .filter((segment) => !/^[_.:/-]+$/.test(segment))
        .map((segment) => (/^(?:massive|polygon)$/i.test(segment) ? MARKET_DATA_LABEL : segment))
        .join(" ");
    }
  }

  return value;
}

/**
 * Returns a neutral display host for provider-owned URLs. Callers keep the
 * original URL as the anchor target so citations remain directly clickable.
 */
export function sourceHostPresentationLabel(url?: string): string {
  if (!url) return "source";

  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "");
    if (
      hostname === "massive.com" ||
      hostname.endsWith(".massive.com") ||
      hostname === "polygon.io" ||
      hostname.endsWith(".polygon.io")
    ) {
      return MARKET_DATA_SOURCE_LABEL;
    }
    return hostname;
  } catch {
    return "source";
  }
}
