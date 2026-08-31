import type { Confidence, Source } from "@/api/types";

const PROVIDER_NAMES: Record<Source["provider"], string> = {
  exa: "Exa web search",
  openrouter: "OpenRouter",
  gemini: "Google Gemini",
  massive: "Market data",
  yahoo: "Yahoo Finance",
  polygon: "Market data",
  sec: "U.S. SEC",
  fred: "FRED",
  manual: "Manual source",
};

const MARKET_DATA_LABEL = "Market data";
const MARKET_DATA_HOST_LABEL = "Market data source";

const BRANDED_METADATA_LABELS = new Set([
  "massive",
  "massive api",
  "massive market data",
  "massive.com",
  "api.massive.com",
  "polygon",
  "polygon api",
  "polygon market data",
  "polygon.io",
  "api.polygon.io",
]);

const BRANDED_NEWS_LABELS = new Set(["massive news", "polygon news"]);

const BRANDED_HOST_SUFFIXES = ["massive.com", "polygon.io"] as const;

const BRANDED_FRESHNESS_COPY: Record<string, string> = {
  "real-time, source: massive": "Real-time market data",
  "real-time, source: polygon": "Real-time market data",
  "real-time, source: polygon.io": "Real-time market data",
  "delayed, source: massive": "Delayed market data",
  "delayed, source: polygon": "Delayed market data",
  "delayed, source: polygon.io": "Delayed market data",
  "delayed by 15 min, source: massive": "Delayed market data",
  "delayed by 15 min, source: polygon": "Delayed market data",
  "delayed by 15 min, source: polygon.io": "Delayed market data",
  "end-of-day, source: massive": "End-of-day market data",
  "end-of-day, source: polygon": "End-of-day market data",
  "end-of-day, source: polygon.io": "End-of-day market data",
  "freshness depends on massive subscription, source: massive":
    "Freshness depends on market data availability",
  "freshness depends on polygon subscription, source: polygon":
    "Freshness depends on market data availability",
  "freshness depends on polygon.io subscription, source: polygon.io":
    "Freshness depends on market data availability",
};

const CONFIDENCE_COPY: Record<Confidence, { label: string; meaning: string }> = {
  high: {
    label: "High confidence",
    meaning: "A strong lead from this returned source.",
  },
  medium: {
    label: "Medium confidence",
    meaning: "Useful context; confirm it before acting.",
  },
  low: {
    label: "Low confidence",
    meaning: "A lead, not a conclusion; confirm it before acting.",
  },
};

export type EvidenceLink = {
  url: string;
  host: string;
};

export type EvidenceState =
  | {
      kind: "cited";
      summary: string;
    }
  | {
      kind: "uncited";
      summary: string;
    };

/** Human-facing provider names keep raw API enum values out of the UI. */
export function providerName(provider: Source["provider"] | string): string {
  const normalized = provider.trim().toLowerCase();
  return PROVIDER_NAMES[normalized as Source["provider"]] ?? neutralizeProviderMetadata(provider);
}

/**
 * Neutralizes provider metadata only. Callers deliberately keep prose such as
 * article bodies, research summaries, and reasoning outside this function.
 */
export function neutralizeProviderMetadata(raw: string): string {
  const value = raw.trim();
  if (!value) return value;

  const normalized = value.toLowerCase();
  if (BRANDED_NEWS_LABELS.has(normalized)) return "Market news";
  if (BRANDED_METADATA_LABELS.has(normalized)) {
    return normalized.includes(".com") || normalized.includes(".io")
      ? MARKET_DATA_HOST_LABEL
      : MARKET_DATA_LABEL;
  }

  const freshness = BRANDED_FRESHNESS_COPY[normalized];
  if (freshness) return freshness;

  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      displayEvidenceHost(parsed.hostname) === MARKET_DATA_HOST_LABEL
    ) {
      return MARKET_DATA_HOST_LABEL;
    }
  } catch {
    // Most metadata is a label rather than a URL.
  }

  // Tool identifiers often arrive as `get_massive_quote`. Humanize only
  // identifier-shaped metadata that contains an exact branded segment.
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

/** Host text is presentation-only; the original URL remains the link target. */
export function displayEvidenceHost(hostname: string): string {
  const host = hostname
    .trim()
    .replace(/^www\./i, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (BRANDED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    return MARKET_DATA_HOST_LABEL;
  }
  return host;
}

export function confidenceLabel(confidence: Confidence): string {
  return CONFIDENCE_COPY[confidence].label;
}

/** Explains the API confidence without presenting a source as independent proof. */
export function confidenceMeaning(confidence: Confidence): string {
  return CONFIDENCE_COPY[confidence].meaning;
}

/**
 * Source.fetchedAt is the only freshness signal in the source contract. Keep
 * the label literal so we never imply that a source was independently updated.
 */
export function formatEvidenceFetchedAt(raw: string): string | undefined {
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return undefined;

  return `Fetched ${new Date(timestamp).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

/**
 * Only browser-safe HTTP(S) locations become tappable. The source payload is
 * server data, so a malformed, custom-scheme, or credential-bearing URL stays
 * visible only as an unavailable link rather than being passed to Linking.
 */
export function safeEvidenceLink(raw?: string): EvidenceLink | undefined {
  if (!raw || raw.trim() !== raw) return undefined;

  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }

    return {
      url: parsed.toString(),
      host: displayEvidenceHost(parsed.hostname),
    };
  } catch {
    return undefined;
  }
}

/** A source count is evidence metadata, not a claim that it independently verifies a match. */
export function evidenceState(sources: readonly Source[]): EvidenceState {
  if (sources.length === 0) {
    return {
      kind: "uncited",
      summary:
        "No citations returned. Treat this match as low confidence until evidence is available.",
    };
  }

  return {
    kind: "cited",
    summary: `${sources.length} returned ${sources.length === 1 ? "source" : "sources"}`,
  };
}
