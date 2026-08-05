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
    fg: "#F2F4F5",
    fgMuted: "#8B939C",
    fgDim: "#5C6570",
    accent: "#3ECF8E",
    accentHover: "#52D99C",
    accentMuted: "#1F6B4A",
    accentInk: "#0A1F14",
    warn: "#E8A054",
    danger: "#E85D5D",
    border: "#242A32",
    borderStrong: "#323A45",
    focusRing: "rgba(62, 207, 142, 0.45)",
  },
  font: {
    display: '"Syne", "Avenir Next", "Segoe UI", sans-serif',
    sans: '"IBM Plex Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 16,
    xl: 22,
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
  motion: {
    fast: "140ms",
    base: "220ms",
    slow: "420ms",
    ease: "cubic-bezier(0.22, 1, 0.36, 1)",
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
    "--mv-fg": t.color.fg,
    "--mv-fg-muted": t.color.fgMuted,
    "--mv-fg-dim": t.color.fgDim,
    "--mv-accent": t.color.accent,
    "--mv-accent-hover": t.color.accentHover,
    "--mv-accent-muted": t.color.accentMuted,
    "--mv-accent-ink": t.color.accentInk,
    "--mv-warn": t.color.warn,
    "--mv-danger": t.color.danger,
    "--mv-border": t.color.border,
    "--mv-border-strong": t.color.borderStrong,
    "--mv-focus": t.color.focusRing,
    "--mv-font-display": t.font.display,
    "--mv-font-sans": t.font.sans,
    "--mv-font-mono": t.font.mono,
    "--mv-radius-sm": `${t.radius.sm}px`,
    "--mv-radius-md": `${t.radius.md}px`,
    "--mv-radius-lg": `${t.radius.lg}px`,
    "--mv-radius-xl": `${t.radius.xl}px`,
    "--mv-ease": t.motion.ease,
    "--mv-fast": t.motion.fast,
    "--mv-base": t.motion.base,
  };
}
