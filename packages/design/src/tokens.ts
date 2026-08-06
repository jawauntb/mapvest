/**
 * Atlas Signal — Mapvest design tokens.
 * Single source of truth for web CSS vars and iOS theme.
 * Swap themes by exporting alternate palettes; surfaces consume tokens only.
 */

export const atlasSignal = {
  id: "atlas-signal",
  name: "Atlas Signal",
  color: {
    bg: "#0C0E10",
    bgElevated: "#161A1F",
    bgSunken: "#08090B",
    // Glass surface for cards/sheets — subtle, not neon. Pairs with a
    // backdrop blur on web and a BlurView on iOS.
    bgGlass: "rgba(22, 26, 31, 0.66)",
    fg: "#F2F4F5",
    fgMuted: "#8B939C",
    fgDim: "#5C6570",
    accent: "#3ECF8E",
    accentHover: "#52D99C",
    accentMuted: "#1F6B4A",
    accentInk: "#0A1F14",
    // Secondary accent — "map blue", the other half of the map+invest
    // story. Deliberately not purple (brand rule): jade = invest signal,
    // signal blue = the map/place signal. Used for gradients, secondary
    // CTAs, and diagram accents only — jade stays the primary action color.
    accent2: "#2F8FEF",
    accent2Hover: "#4FA4FF",
    accent2Muted: "#173F73",
    // The "Atlas sweep" — jade to signal-blue. Hero backgrounds, chart
    // strokes, loading sweeps. Flat gradient, no bloom/glow.
    gradient: "linear-gradient(135deg, #3ECF8E 0%, #21B5A6 45%, #2F8FEF 100%)",
    warn: "#E8A054",
    danger: "#E85D5D",
    border: "#242A32",
    borderStrong: "#323A45",
    glassBorder: "rgba(242, 244, 245, 0.08)",
    focusRing: "rgba(62, 207, 142, 0.45)",
  },
  font: {
    display: '"Syne", "Avenir Next", "Segoe UI", sans-serif',
    sans: '"IBM Plex Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  /** Type scale shared by web (rem via CSS) and iOS (pt via RN). Values are px/pt. */
  type: {
    display: { size: 44, line: 48, weight: "800", tracking: -0.02 },
    h1: { size: 32, line: 38, weight: "800", tracking: -0.02 },
    h2: { size: 24, line: 30, weight: "700", tracking: -0.01 },
    h3: { size: 18, line: 24, weight: "700", tracking: -0.005 },
    body: { size: 15, line: 22, weight: "400", tracking: 0 },
    label: { size: 13, line: 16, weight: "600", tracking: 0.02 },
    caption: { size: 11, line: 14, weight: "600", tracking: 0.03 },
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 16,
    xl: 22,
    pill: 999,
  },
  space: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 24,
    6: 32,
    7: 48,
    8: 64,
  },
  /** Elevation — soft, directional shadows. No glow/bloom per brand rule. */
  elevation: {
    sm: "0 1px 2px rgba(0,0,0,0.24), 0 1px 1px rgba(0,0,0,0.16)",
    md: "0 4px 12px rgba(0,0,0,0.32), 0 1px 2px rgba(0,0,0,0.24)",
    lg: "0 12px 32px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.28)",
  },
  motion: {
    fast: "140ms",
    base: "220ms",
    slow: "420ms",
    ease: "cubic-bezier(0.22, 1, 0.36, 1)",
    // Reanimated spring presets (iOS) — snappy, not bouncy.
    springSnappy: { damping: 18, stiffness: 220, mass: 0.9 },
    springSoft: { damping: 20, stiffness: 140, mass: 1 },
  },
} as const;

export type DesignTokens = typeof atlasSignal;

/** Active theme — change this to restyle the product. */
export const tokens = atlasSignal;

export function cssVariables(t: DesignTokens = tokens): Record<string, string> {
  return {
    "--mv-bg": t.color.bg,
    "--mv-bg-elev": t.color.bgElevated,
    "--mv-bg-sunken": t.color.bgSunken,
    "--mv-bg-glass": t.color.bgGlass,
    "--mv-fg": t.color.fg,
    "--mv-fg-muted": t.color.fgMuted,
    "--mv-fg-dim": t.color.fgDim,
    "--mv-accent": t.color.accent,
    "--mv-accent-hover": t.color.accentHover,
    "--mv-accent-muted": t.color.accentMuted,
    "--mv-accent-ink": t.color.accentInk,
    "--mv-accent2": t.color.accent2,
    "--mv-accent2-hover": t.color.accent2Hover,
    "--mv-accent2-muted": t.color.accent2Muted,
    "--mv-gradient": t.color.gradient,
    "--mv-warn": t.color.warn,
    "--mv-danger": t.color.danger,
    "--mv-border": t.color.border,
    "--mv-border-strong": t.color.borderStrong,
    "--mv-glass-border": t.color.glassBorder,
    "--mv-focus": t.color.focusRing,
    "--mv-font-display": t.font.display,
    "--mv-font-sans": t.font.sans,
    "--mv-font-mono": t.font.mono,
    "--mv-radius-sm": `${t.radius.sm}px`,
    "--mv-radius-md": `${t.radius.md}px`,
    "--mv-radius-lg": `${t.radius.lg}px`,
    "--mv-radius-xl": `${t.radius.xl}px`,
    "--mv-radius-pill": `${t.radius.pill}px`,
    "--mv-shadow-sm": t.elevation.sm,
    "--mv-shadow-md": t.elevation.md,
    "--mv-shadow-lg": t.elevation.lg,
    "--mv-ease": t.motion.ease,
    "--mv-fast": t.motion.fast,
    "--mv-base": t.motion.base,
    "--mv-slow": t.motion.slow,
  };
}
