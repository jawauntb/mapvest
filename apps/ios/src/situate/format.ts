/**
 * Pure formatting + vocabulary helpers for the Situate dashboard.
 *
 * Deliberately free of react-native and of any `@/` runtime import so
 * `bun test apps/ios/src/situate` can cover them directly.
 *
 * House rules, from the packet contract:
 *   • Returns are decimal fractions (0.034 → "3.4%").
 *   • `null` is "could not compute", never zero — every formatter falls back
 *     to an em dash rather than inventing a number.
 *   • The call is a POSTURE, never buy/sell, never a point price target.
 */
import type { SituateHorizonKey, SituateStance } from "./constants";
import { SITUATE_STALE_AFTER_MS } from "./constants";

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

/** A value already expressed in percentage points (IV, yields, spreads). */
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

/** Valuation multiples / ratios read as "1.24×". */
export function fmtMultiple(value: unknown, digits = 2, fallback = DASH): string {
  const v = num(value);
  return v === null ? fallback : `${v.toFixed(digits)}×`;
}

/** A z-score reads with an explicit sign: "+1.4σ". */
export function fmtZ(value: unknown, digits = 1, fallback = DASH): string {
  const v = num(value);
  if (v === null) return fallback;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(digits)}σ`;
}

export function fmtCount(value: unknown, fallback = DASH): string {
  const v = num(value);
  return v === null ? fallback : Math.round(v).toLocaleString("en-US");
}

/** `"low_up"` / `"risk factors"` → `"Low up"` / `"Risk factors"`. */
export function humanize(raw: unknown, fallback = DASH): string {
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  const spaced = raw.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Screaming horizon label for chips and axis ticks: `"3"` → `"3M"`. */
export function horizonLabel(h: SituateHorizonKey | string): string {
  const s = String(h);
  return /^\d+$/.test(s) ? `${s}M` : s.toUpperCase();
}

/**
 * The posture chip's horizon, unit-attached. The engine emits `posture.horizon`
 * as a bare integer (`6`), which would render as an ambiguous "· 6"; a plain
 * number gets an "m" suffix ("6m", matching the memo prose "at 6 months"), while
 * a string the engine already spelled ("3m") passes through. `null` for a
 * missing/empty horizon so callers can drop the suffix entirely.
 */
export function postureHorizon(h: unknown): string | null {
  if (typeof h === "number" && Number.isFinite(h)) return `${h}m`;
  if (typeof h === "string" && h.trim()) return h.trim();
  return null;
}

// -------- posture grammar (NOT buy/sell) --------

const STANCE_LABELS: Readonly<Record<SituateStance, string>> = {
  odds_favorable: "Odds favorable",
  balanced: "Balanced",
  odds_unfavorable: "Odds unfavorable",
};

const STANCE_TONES: Readonly<Record<SituateStance, Tone>> = {
  odds_favorable: "bull",
  balanced: "neutral",
  odds_unfavorable: "bear",
};

export function isStance(v: unknown): v is SituateStance {
  return typeof v === "string" && v in STANCE_LABELS;
}

export function stanceLabel(stance: unknown): string {
  return isStance(stance) ? STANCE_LABELS[stance] : DASH;
}

export function stanceTone(stance: unknown): Tone {
  return isStance(stance) ? STANCE_TONES[stance] : "neutral";
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

/** State / scenario words → the tone that colors them. Unknown stays neutral. */
export function toneForLabel(label: unknown): Tone {
  if (typeof label !== "string") return "neutral";
  const v = label.trim().toLowerCase();
  if (["bull", "bullish", "up", "accelerating", "favorable", "good"].includes(v)) return "bull";
  if (["bear", "bearish", "down", "decelerating", "unfavorable", "bad"].includes(v)) return "bear";
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

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
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

/** `"just now" | "14m ago" | "3h ago" | "2d ago" | "Sep 1, 2026"`. */
export function relativeAge(iso: unknown, now: number = Date.now()): string {
  if (typeof iso !== "string") return DASH;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return DASH;
  const secs = Math.round((now - t) / 1000);
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
 * `GET /v1/situate/:ticker` returns the *latest stored* packet with no age
 * limit, and every price on the screen is the session close the packet was
 * built from.
 */
export function isPacketStale(
  generatedAt: unknown,
  now: number = Date.now(),
  maxAgeMs: number = SITUATE_STALE_AFTER_MS,
): boolean {
  if (typeof generatedAt !== "string") return false;
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t)) return false;
  return now - t > maxAgeMs;
}

// -------- "unavailable: reason" --------

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
