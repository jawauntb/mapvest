import type { RatingAction, RatingDriver, RatingDriverName, RatingResponse } from "@/api/client";
import type { InvestableVerdict } from "@/api/types";

/**
 * Presentation helpers for the Jev rating chip and the snap verdict chip.
 * Pure — no React, no network — so the copy is unit-testable and every
 * surface (detail header, camera card) renders the same words.
 */

export const ACTION_LABEL: Record<RatingAction, string> = {
  strong_buy: "STRONG BUY",
  buy: "BUY",
  hold: "HOLD",
  sell: "SELL",
  strong_sell: "STRONG SELL",
};

export const DRIVER_LABEL: Record<RatingDriverName, string> = {
  valuation: "Valuation",
  momentum: "Momentum",
  fundamentals: "Fundamentals",
  narrative: "News flow",
  macro: "Macro",
  local_demand: "Demand pulse",
  peer_forecast: "Peer forecast",
};

export const SOURCE_LABEL: Record<string, string> = {
  quote: "Price & momentum",
  ratios: "Financial ratios",
  synthesis_memo: "Synthesis memo",
  demand_pulse: "Demand pulse",
  environment_brief: "Sector environment",
  prism: "Prism packet",
  situate: "Situate packet",
  headlines: "Material headlines",
  peer_forecast: "Peer forecast (TabICL)",
};

export type RatingTone = "up" | "down" | "neutral" | "muted";

/** `"BUY · 72%"`, or `null` when there is no rating to show. */
export function ratingChipLabel(r: RatingResponse | null | undefined): string | null {
  if (!r || r.status !== "ok" || !r.rating) return null;
  return `${ACTION_LABEL[r.rating.action]} · ${Math.round(r.rating.conviction * 100)}%`;
}

export function ratingTone(r: RatingResponse | null | undefined): RatingTone {
  if (!r || r.status !== "ok" || !r.rating) return "muted";
  switch (r.rating.action) {
    case "strong_buy":
    case "buy":
      return "up";
    case "sell":
    case "strong_sell":
      return "down";
    default:
      return "neutral";
  }
}

export function driverGlyph(d: RatingDriver): string {
  return d.direction === "up" ? "↑" : d.direction === "down" ? "↓" : "→";
}

/** `"Momentum ↑ · 64%"` — one drivers row. */
export function driverLine(d: RatingDriver): string {
  return `${DRIVER_LABEL[d.name] ?? d.name} ${driverGlyph(d)} · ${Math.round(d.weight * 100)}%`;
}

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

/**
 * Snap verdict chip copy: `"Investable via parent · NKE · 88%"`,
 * `"Proxy exposure via XLY"`, `"Direct · NKE · 90%"`. `null` when there is
 * no verdict (fail-open) or nothing to say.
 */
export function verdictChipLabel(
  verdict: InvestableVerdict | null | undefined,
  ctx: { ticker?: string; comparable?: string; etf?: string },
): string | null {
  if (!verdict) return null;
  const pct = `${Math.round(verdict.probability * 100)}%`;
  switch (verdict.exposure) {
    case "direct":
      return ctx.ticker ? `Direct · ${ctx.ticker} · ${pct}` : `Directly investable · ${pct}`;
    case "parent":
      return ctx.ticker
        ? `Investable via parent · ${ctx.ticker} · ${pct}`
        : `Investable via parent · ${pct}`;
    case "proxy": {
      const via = ctx.comparable ?? ctx.etf;
      return via ? `Proxy exposure via ${via} · ${pct}` : `Proxy exposure · ${pct}`;
    }
    case "none":
      return `No public exposure · ${pct}`;
    default:
      return null;
  }
}

/** Clients emphasize the watchlist CTA at or above this (mirrors the API constant). */
export const WORTH_A_LOOK_AT = 0.7;

export function worthALook(verdict: InvestableVerdict | null | undefined): boolean {
  return !!verdict && verdict.worth_a_look >= WORTH_A_LOOK_AT && verdict.exposure !== "none";
}
