/**
 * `citation_type` on Prism / Situate memo citations — the engine's own
 * classification of the document a citation points at, attached only when it
 * could classify the row. Mirrors `CitationType` in `packages/core`.
 *
 * `source: "regex"` is an authoritative rule match (confidence is `null`);
 * `source: "jev"` is a Jev classification and carries its confidence
 * (>= 0.55). Rows without the key are unknown — render nothing.
 */

export const CITATION_TYPE_NAMES = [
  "sec_xbrl",
  "sec_filing",
  "sec_trend_pack",
  "sec_earnings_section",
  "earnings_calendar",
  "exa",
] as const;
export type CitationTypeName = (typeof CITATION_TYPE_NAMES)[number];

export type CitationType = {
  type: CitationTypeName;
  source: "regex" | "jev";
  confidence?: number | null;
};

type Row = { citation_type?: CitationType | null };

/** Defensive read: a malformed or unknown annotation renders as "no badge". */
export function citationTypeOf(row: Row | null | undefined): CitationType | null {
  const ct = row?.citation_type;
  if (!ct || typeof ct !== "object") return null;
  if (!(CITATION_TYPE_NAMES as readonly string[]).includes(ct.type)) return null;
  if (ct.source !== "regex" && ct.source !== "jev") return null;
  return ct;
}

const TYPE_LABEL: Record<CitationTypeName, string> = {
  sec_xbrl: "SEC XBRL",
  sec_filing: "SEC filing",
  sec_trend_pack: "SEC trends",
  sec_earnings_section: "Earnings call",
  earnings_calendar: "Earnings date",
  exa: "Web",
};

/** Short badge copy. */
export function citationTypeLabel(ct: CitationType): string {
  return TYPE_LABEL[ct.type];
}

/** One line for a tooltip / tap: how the badge was decided and how sure. */
export function citationTypeDetail(ct: CitationType): string {
  if (ct.source === "regex") return "Matched by rule (regex)";
  const pct =
    typeof ct.confidence === "number" && Number.isFinite(ct.confidence)
      ? ` · ${Math.round(ct.confidence * 100)}% confidence`
      : "";
  return `Classified by Jev${pct}`;
}
