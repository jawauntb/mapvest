import type { Tone } from "@/prism/format";
/**
 * Chart palette for the Prism dashboard.
 *
 * The terminal charts in `src/chartkit/*` encode the analyzer's matplotlib
 * look (amber / phosphor green on black) — that is their data contract and it
 * stays where it is. Prism is a *product* surface, so it draws on Atlas Signal
 * (`src/theme/tokens.ts`): near-black ground, jade for constructive, map-blue
 * for secondary structure, red for destructive, warm amber for caution. No
 * purple, no neon.
 */
import { colors } from "@/theme/tokens";

export const chart = {
  bg: colors.bgSunken,
  panel: colors.bgElevated,
  border: colors.border,
  grid: "rgba(242, 244, 245, 0.07)",
  gridStrong: "rgba(242, 244, 245, 0.16)",
  zero: "rgba(242, 244, 245, 0.28)",
  text: colors.fg,
  muted: colors.fgMuted,
  // Axis ticks and gutter labels. Deliberately NOT `colors.fgDim` — these
  // render at 8–9px inside a chart, where fgDim on the sunken ground is
  // ~4.4:1 and unreadable at that size. This sits at ~5.5:1 and still
  // reads a step quieter than `muted`.
  dim: "#7F8892",
  bull: colors.accent,
  bullSoft: "rgba(20, 196, 166, 0.16)",
  bullEdge: "rgba(20, 196, 166, 0.55)",
  bear: colors.danger,
  bearSoft: "rgba(232, 93, 93, 0.16)",
  bearEdge: "rgba(232, 93, 93, 0.55)",
  neutral: colors.fgMuted,
  neutralSoft: "rgba(139, 147, 156, 0.16)",
  info: colors.accent2,
  infoSoft: "rgba(47, 143, 239, 0.18)",
  warn: colors.warn,
  warnSoft: "rgba(232, 160, 84, 0.18)",
} as const;

/** Categorical cycle for multi-series charts. Jade first, then map-blue, amber, mint, slate. */
export const PRISM_SERIES = [
  colors.accent,
  colors.accent2,
  colors.warn,
  colors.accentHover,
  colors.fgMuted,
  colors.accent2Hover,
] as const;

export function seriesColor(i: number): string {
  return (
    PRISM_SERIES[((i % PRISM_SERIES.length) + PRISM_SERIES.length) % PRISM_SERIES.length] ??
    chart.muted
  );
}

export function toneColor(tone: Tone): string {
  return tone === "bull" ? chart.bull : tone === "bear" ? chart.bear : chart.neutral;
}

export function toneSoft(tone: Tone): string {
  return tone === "bull" ? chart.bullSoft : tone === "bear" ? chart.bearSoft : chart.neutralSoft;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const RGB_BULL = hexToRgb(colors.accent);
const RGB_BEAR = hexToRgb(colors.danger);
/** Cell ground at zero — a hair above the panel so an empty cell still reads as a cell. */
const RGB_ZERO: [number, number, number] = [26, 31, 37];

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const f = Math.min(1, Math.max(0, t));
  const c = (i: 0 | 1 | 2) => Math.round(a[i] + (b[i] - a[i]) * f);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
}

/**
 * Diverging fill for a signed value over a symmetric `±max` domain: jade above
 * zero, red below, the panel ground at zero. `null` returns the ground, which
 * is how a "could not compute" cell reads as absent rather than as neutral.
 */
export function divergingColor(value: number | null | undefined, max: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || !(max > 0)) {
    return mix(RGB_ZERO, RGB_ZERO, 0);
  }
  const t = Math.min(1, Math.abs(value) / max);
  return value >= 0 ? mix(RGB_ZERO, RGB_BULL, t) : mix(RGB_ZERO, RGB_BEAR, t);
}

/** Text color that stays legible on top of `divergingColor` at the same intensity. */
export function onDivergingText(value: number | null | undefined, max: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || !(max > 0)) return chart.dim;
  return Math.abs(value) / max > 0.55 ? colors.accentInk : chart.text;
}
