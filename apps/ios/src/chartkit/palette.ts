import { Platform } from "react-native";

/**
 * Underlying Terminal palette — 1:1 with the analyzer's matplotlib constants
 * (app/charts.py) per its chart-data rendering guide. These tokens are scoped
 * to chart surfaces only; everything else in the app stays on the Atlas
 * Signal tokens in src/theme/tokens.ts. Keep the two systems separate — the
 * terminal look is the data-encoding contract of these charts (green=bull,
 * red=bear, amber=levels/brand), not a general app theme.
 */
export const terminal = {
  chartBg: "#05070a",
  axBg: "#081016",
  panel: "#0d171d",
  grid: "#24444a",
  text: "#fff4c2",
  textStrong: "#fff9d9",
  muted: "#9fb0a8",
  amber: "#ffc94a",
  amberHot: "#ffe66f",
  green: "#79ff9c",
  cyan: "#57d9ff",
  red: "#ff695d",
  violet: "#b28cff",
  orange: "#ffae57",
} as const;

/** Holdings line cycle on the portfolio chart (thin, ~58% opacity). */
export const PORTFOLIO_LINE_CYCLE = [
  terminal.cyan,
  terminal.violet,
  terminal.green,
  terminal.red,
  terminal.orange,
  "#8ef6d1",
  "#d7a5ff",
] as const;

/** Bar color cycle on the volatility radar. */
export const VOLATILITY_BAR_CYCLE = [
  terminal.amber,
  terminal.green,
  terminal.cyan,
  terminal.red,
  terminal.violet,
  terminal.orange,
  "#8ef6d1",
] as const;

/** Monospace family for footer stat strips, pills, and tables. */
export const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

// -------- performance heatmap colormap --------

type Stop = { t: number; rgb: [number, number, number] };

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const HEAT_STOPS: Stop[] = [
  { t: 0.0, rgb: hexToRgb("#ff4d5a") },
  { t: 0.42, rgb: hexToRgb("#172126") },
  { t: 0.5, rgb: hexToRgb("#263237") },
  { t: 0.72, rgb: hexToRgb(terminal.green) },
  { t: 1.0, rgb: hexToRgb(terminal.cyan) },
];

/**
 * Diverging monthly-return colormap. `t` in [0,1] where 0.5 = 0% over the
 * symmetric domain ±max(5, |max value|).
 */
export function returnHeatColor(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  let lo = HEAT_STOPS[0] as Stop;
  let hi = HEAT_STOPS[HEAT_STOPS.length - 1] as Stop;
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    const a = HEAT_STOPS[i] as Stop;
    const b = HEAT_STOPS[i + 1] as Stop;
    if (x >= a.t && x <= b.t) {
      lo = a;
      hi = b;
      break;
    }
  }
  const span = hi.t - lo.t || 1;
  const f = (x - lo.t) / span;
  const mix = (i: 0 | 1 | 2) => Math.round(lo.rgb[i] + (hi.rgb[i] - lo.rgb[i]) * f);
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

// -------- threshold color rules (from app/charts.py + app/torque.py) --------

/** Flow-compass component bars: green > +15, red < −15, muted between. */
export function flowComponentColor(score: number | null): string {
  if (score == null) return terminal.muted;
  if (score > 15) return terminal.green;
  if (score < -15) return terminal.red;
  return terminal.muted;
}

/** Torque component bars: >=70 green, >=50 cyan, >=30 amber, else red. */
export function torqueComponentColor(score: number): string {
  if (score >= 70) return terminal.green;
  if (score >= 50) return terminal.cyan;
  if (score >= 30) return terminal.amber;
  return terminal.red;
}

/** Torque total gauge: >=75 green, >=60 cyan, >=45 amber, >=30 amber-hot, else red. */
export function torqueGaugeColor(score: number): string {
  if (score >= 75) return terminal.green;
  if (score >= 60) return terminal.cyan;
  if (score >= 45) return terminal.amber;
  if (score >= 30) return terminal.amberHot;
  return terminal.red;
}

/** Torque stage chips: Coiled Spring green, Inflecting cyan, Proof amber, Renaming amber-hot, Extended red. */
export const TORQUE_STAGE_COLORS: ReadonlyArray<{ label: string; color: string }> = [
  { label: "Coiled Spring", color: terminal.green },
  { label: "Inflecting", color: terminal.cyan },
  { label: "Proof Phase", color: terminal.amber },
  { label: "Renaming Phase", color: terminal.amberHot },
  { label: "Extended", color: terminal.red },
];

export function torqueStageColor(stage: string): string {
  return TORQUE_STAGE_COLORS.find((s) => s.label === stage)?.color ?? terminal.muted;
}
