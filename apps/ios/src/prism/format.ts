/**
 * Pure formatting + vocabulary helpers for the Prism dashboard.
 *
 * Deliberately free of react-native and of any `@/` runtime import so
 * `bun test apps/ios/src/prism` can cover them directly.
 *
 * House rules, from the packet contract:
 *   • Returns are decimal fractions (0.034 → "3.4%").
 *   • `null` is "could not compute", never zero — every formatter falls back
 *     to an em dash rather than inventing a number.
 */
import type {
  PrismHorizonKey,
  PrismPacket,
  PrismRecommendationAction,
  PrismSectionKey,
} from "@/api/prism";
import { PRISM_STALE_AFTER_MS } from "./constants";

export const DASH = "—";

export type Tone = "bull" | "bear" | "neutral";

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Decimal fraction → percent. `0.0341 → "3.4%"`. */
export function fmtPct(value: unknown, digits = 1, fallback = DASH): string {
  const v = num(value);
  if (v === null) return fallback;
  return `${(v * 100).toFixed(digits)}%`;
}

/** Percent with an explicit sign — the form used on every return readout. */
export function fmtSignedPct(value: unknown, digits = 1, fallback = DASH): string {
  const v = num(value);
  if (v === null) return fallback;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${(Math.abs(v) * 100).toFixed(digits)}%`;
}

/** A value already expressed in percentage points (yields, IV, spreads). */
export function fmtPoints(value: unknown, digits = 2, suffix = "%", fallback = DASH): string {
  const v = num(value);
  if (v === null) return fallback;
  return `${v.toFixed(digits)}${suffix}`;
}

export function fmtPrice(value: unknown, fallback = DASH): string {
  const v = num(value);
  if (v === null) return fallback;
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : abs >= 10 ? 2 : 3;
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** 1.24e12 → "$1.24T". Used for market cap, revenue, cash. */
export function fmtMoneyCompact(value: unknown, fallback = DASH): string {
  const v = num(value);
  if (v === null) return fallback;
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function fmtNumber(value: unknown, digits = 2, fallback = DASH): string {
  const v = num(value);
  return v === null ? fallback : v.toFixed(digits);
}

/** Valuation multiples read as "24.1×". */
export function fmtMultiple(value: unknown, digits = 1, fallback = DASH): string {
  const v = num(value);
  return v === null ? fallback : `${v.toFixed(digits)}×`;
}

export function fmtCount(value: unknown, fallback = DASH): string {
  const v = num(value);
  return v === null ? fallback : Math.round(v).toLocaleString("en-US");
}

/** `"strong_buy"` / `"risk factors"` → `"Strong buy"` / `"Risk factors"`. */
export function humanize(raw: unknown, fallback = DASH): string {
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  const spaced = raw.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Short screaming label for chips and axis ticks: `"1m"` → `"1M"`. */
export function horizonLabel(h: PrismHorizonKey): string {
  return h.toUpperCase();
}

// -------- recommendation grammar --------

const ACTION_LABELS: Readonly<Record<PrismRecommendationAction, string>> = {
  strong_buy: "Strong buy",
  buy: "Buy",
  hold: "Hold",
  sell: "Sell",
  strong_sell: "Strong sell",
};

const ACTION_TONES: Readonly<Record<PrismRecommendationAction, Tone>> = {
  strong_buy: "bull",
  buy: "bull",
  hold: "neutral",
  sell: "bear",
  strong_sell: "bear",
};

export function isRecommendationAction(v: unknown): v is PrismRecommendationAction {
  return typeof v === "string" && v in ACTION_LABELS;
}

export function recommendationLabel(action: unknown): string {
  return isRecommendationAction(action) ? ACTION_LABELS[action] : DASH;
}

export function recommendationTone(action: unknown): Tone {
  return isRecommendationAction(action) ? ACTION_TONES[action] : "neutral";
}

/** Conviction is `[0,1]`; the band words are what the meter labels itself with. */
export function convictionLabel(conviction: unknown): string {
  const v = num(conviction);
  if (v === null) return "Conviction unstated";
  if (v >= 0.75) return "High conviction";
  if (v >= 0.5) return "Moderate conviction";
  if (v >= 0.25) return "Low conviction";
  return "Very low conviction";
}

/** Regime / scenario words → the tone that colors them. Unknown stays neutral. */
export function toneForLabel(label: unknown): Tone {
  if (typeof label !== "string") return "neutral";
  const v = label.trim().toLowerCase();
  if (v === "bull" || v === "bullish" || v === "accelerating" || v === "good") return "bull";
  if (v === "bear" || v === "bearish" || v === "decelerating" || v === "bad") return "bear";
  return "neutral";
}

/** Signed numbers pick their own tone: positive is bull, negative bear, 0 neutral. */
export function toneForValue(value: unknown, deadband = 0): Tone {
  const v = num(value);
  if (v === null) return "neutral";
  if (v > deadband) return "bull";
  if (v < -deadband) return "bear";
  return "neutral";
}

// -------- dates --------

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** `"2026-09-01"` → `"Sep 1, 2026"`. Parsed by hand so no timezone shifts the day. */
export function fmtDate(iso: unknown, fallback = DASH): string {
  if (typeof iso !== "string") return fallback;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return fallback;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return fallback;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

/** `"2026-09"` or `"2026-09-01"` → `"Sep '26"`. */
export function fmtMonth(iso: unknown, fallback = DASH): string {
  if (typeof iso !== "string") return fallback;
  const m = /^(\d{4})-(\d{2})/.exec(iso.trim());
  if (!m) return fallback;
  const month = MONTHS[Number(m[2]) - 1];
  const year = m[1];
  if (!month || !year) return fallback;
  return `${month} '${year.slice(2)}`;
}

/** `"just now" | "14m ago" | "3h ago" | "2d ago" | "Sep 1, 2026"`. */
export function relativeAge(iso: unknown, now: number = Date.now()): string {
  if (typeof iso !== "string") return DASH;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return DASH;
  const secs = Math.round((now - t) / 1000);
  if (secs < 0) return "just now";
  if (secs < 90) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days}d ago`;
  return fmtDate(iso);
}

/**
 * Is this packet old enough that its prices should not be shown unqualified?
 *
 * `GET /v1/prism/:ticker` returns the *latest stored* packet with no age
 * limit, and every price on the screen is the session close the packet was
 * built from. A packet from three weeks ago renders a three-week-old close in
 * 22pt next to a live-looking BUY chip unless the screen says otherwise.
 */
export function isPacketStale(
  generatedAt: unknown,
  now: number = Date.now(),
  maxAgeMs: number = PRISM_STALE_AFTER_MS,
): boolean {
  if (typeof generatedAt !== "string") return false;
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t)) return false;
  return now - t > maxAgeMs;
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// -------- "unavailable: reason" --------

/**
 * Why a section is `null`. The engine writes a `<section>_error` sibling on the
 * packet and also appends to `meta.errors`; we prefer the sibling and fall back
 * to the ledger, so a section never silently renders as empty.
 */
export function sectionError(
  packet: Pick<PrismPacket, "meta"> & { [k: string]: unknown },
  key: PrismSectionKey,
): string | null {
  const sibling = packet[`${key}_error`];
  if (typeof sibling === "string" && sibling.trim()) return sibling.trim();
  const errors = packet.meta?.errors ?? [];
  for (const entry of errors) {
    if (entry && entry.source === key && typeof entry.error === "string" && entry.error.trim()) {
      return entry.error.trim();
    }
  }
  return null;
}

/**
 * The reason string a section card should render, or `null` when the section is
 * present. Collapses the two-step "is it null / why is it null" into the one
 * question every section asks.
 */
export function sectionUnavailable(
  packet: Pick<PrismPacket, "meta"> & { [k: string]: unknown },
  key: PrismSectionKey,
  section: unknown,
): string | null {
  if (section !== null && section !== undefined) return null;
  return sectionError(packet, key) ?? "the engine did not return this section";
}

/**
 * The single line a null section renders. Always names the reason when we have
 * one. The first letter is lowercased only when it is not part of an acronym
 * ("SEC EDGAR timed out" must not become "sEC EDGAR…").
 */
export function unavailableCopy(reason: string | null | undefined): string {
  const r = (reason ?? "").trim();
  if (!r) return "Unavailable: the engine did not return this section.";
  const head = r.charAt(0);
  const second = r.charAt(1);
  const lead = second && second === second.toLowerCase() ? head.toLowerCase() : head;
  return `Unavailable: ${lead}${r.slice(1)}`;
}
