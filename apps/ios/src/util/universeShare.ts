import type { Source } from "@/api/types";
import { providerName } from "@/evidence/presentation";
import { MAPVEST_URL } from "@/util/shareLinks";

/**
 * The only data allowed into a Universe share is the server-produced summary.
 * Keeping this boundary separate from `Find` makes it difficult to leak a
 * photo, place, coordinate, or account identifier into a share artifact.
 */
export type UniverseShareSummary = {
  findCount: number;
  valuedFinds: number;
  hypotheticalBasis?: number;
  hypotheticalValue: number;
  changePct: number;
  generatedAt: string;
  sources: readonly Source[];
};

export type UniverseShareCopy = {
  eyebrow: string;
  headline: string;
  value: string;
  change: string;
  changePositive: boolean | null;
  basis: string;
  coverage: string;
  provenance: string;
  disclaimer: string;
  footer: string;
  body: string;
  message: string;
};

function finiteCount(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function formatCount(value: number): string | null {
  const count = finiteCount(value);
  return count === null ? null : count.toLocaleString("en-US");
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return "Value unavailable";
  const decimals = Math.abs(value) < 1000 ? 2 : 0;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function formatChange(value: number): string {
  if (!Number.isFinite(value)) return "Change unavailable";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatBasis(value: number | undefined): string {
  // `hypotheticalBasis` is the total counterfactual basis across valued finds,
  // not a per-find amount. Keep that distinction visible in shared copy.
  return value !== undefined && Number.isFinite(value)
    ? `Hypothetical basis ${formatMoney(value)}`
    : "Hypothetical basis unavailable";
}

function formatCalculatedAt(raw: string): string {
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return "Calculated time unavailable";

  return `Calculated ${new Date(timestamp).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function formatProvenance(sources: readonly Source[], generatedAt: string): string {
  const calculatedAt = formatCalculatedAt(generatedAt);
  const providers = [
    ...new Set(
      sources
        .map((source) => providerName(source.provider))
        .filter(
          (provider): provider is string => typeof provider === "string" && provider.length > 0,
        ),
    ),
  ];
  const confidence = sources.some((source) => source.confidence === "low")
    ? "low"
    : sources.some((source) => source.confidence === "medium")
      ? "medium"
      : sources.every((source) => source.confidence === "high")
        ? "high"
        : "low";

  if (sources.length === 0) {
    return `No source citations returned · low confidence · ${calculatedAt}`;
  }
  if (providers.length === 0) {
    return `Source attribution unavailable · ${confidence} confidence · ${calculatedAt}`;
  }

  return `Sources: ${providers.join(", ")} · ${confidence} confidence · ${calculatedAt}`;
}

function formatCoverage(summary: UniverseShareSummary): string {
  const valued = formatCount(summary.valuedFinds);
  const total = formatCount(summary.findCount);
  if (valued !== null && total !== null) {
    const noun = finiteCount(summary.findCount) === 1 ? "find" : "finds";
    return `${valued} of ${total} ${noun} priced when found`;
  }
  if (valued !== null) return `${valued} priced finds`;
  if (total !== null) return `${total} total finds; priced count unavailable`;
  return "Find count unavailable";
}

/**
 * Build the complete copy used by both the PNG card and its paste-safe text
 * fallback. It deliberately contains summary metrics only — never raw Find
 * records or user-provided strings.
 */
export function universeShareCopy(summary: UniverseShareSummary): UniverseShareCopy {
  const value = formatMoney(summary.hypotheticalValue);
  const change = formatChange(summary.changePct);
  const changePositive = Number.isFinite(summary.changePct) ? summary.changePct >= 0 : null;
  const basis = formatBasis(summary.hypotheticalBasis);
  const coverage = formatCoverage(summary);
  const provenance = formatProvenance(summary.sources, summary.generatedAt);
  const disclaimer = "Collection snapshot, not a holdings statement or advice.";
  const eyebrow = "HYPOTHETICAL UNIVERSE";
  const headline = "My Mapvest universe";
  const body = `${basis}\n${coverage}.\n${provenance}\n${disclaimer}`;
  const message = [
    headline,
    "",
    `${eyebrow}: ${basis} → ${value} (${change})`,
    `${coverage}.`,
    provenance,
    disclaimer,
    "",
    `${MAPVEST_URL} · Mapvest`,
  ].join("\n");

  return {
    eyebrow,
    headline,
    value,
    change,
    changePositive,
    basis,
    coverage,
    provenance,
    disclaimer,
    footer: `${MAPVEST_URL} · Mapvest`,
    body,
    message,
  };
}

export function formatUniverseShareText(summary: UniverseShareSummary): string {
  return universeShareCopy(summary).message;
}
