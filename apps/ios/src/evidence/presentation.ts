import type { Confidence, Source } from "@/api/types";

const PROVIDER_NAMES: Record<Source["provider"], string> = {
  exa: "Exa web search",
  openrouter: "OpenRouter",
  gemini: "Google Gemini",
  massive: "Massive market data",
  yahoo: "Yahoo Finance",
  polygon: "Polygon",
  sec: "U.S. SEC",
  fred: "FRED",
  manual: "Manual source",
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
export function providerName(provider: Source["provider"]): string {
  return PROVIDER_NAMES[provider];
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
      host: parsed.hostname.replace(/^www\./i, ""),
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
