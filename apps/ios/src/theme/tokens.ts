/**
 * Atlas Signal tokens for React Native.
 * Mirror of @mapvest/design — keep in sync with packages/design/src/tokens.ts.
 */

export const colors = {
  bg: "#0C0E10",
  bgElevated: "#161A1F",
  bgSunken: "#08090B",
  bgGlass: "rgba(22, 26, 31, 0.66)",
  fg: "#F2F4F5",
  fgMuted: "#8B939C",
  fgDim: "#5C6570",
  accent: "#3ECF8E",
  accentHover: "#52D99C",
  accentMuted: "#1F6B4A",
  accentInk: "#0A1F14",
  // Secondary "map blue" accent — gradients + diagram/secondary CTAs only.
  // Jade stays the primary action color. No purple (brand rule).
  accent2: "#2F8FEF",
  accent2Hover: "#4FA4FF",
  accent2Muted: "#173F73",
  gradient: ["#3ECF8E", "#21B5A6", "#2F8FEF"] as const, // for expo-linear-gradient
  warn: "#E8A054",
  danger: "#E85D5D",
  border: "#242A32",
  borderStrong: "#323A45",
  glassBorder: "rgba(242, 244, 245, 0.08)",
} as const;

export const type = {
  display: { fontSize: 44, lineHeight: 48, fontWeight: "800" as const, letterSpacing: -0.5 },
  h1: { fontSize: 32, lineHeight: 38, fontWeight: "800" as const, letterSpacing: -0.4 },
  h2: { fontSize: 24, lineHeight: 30, fontWeight: "700" as const, letterSpacing: -0.2 },
  h3: { fontSize: 18, lineHeight: 24, fontWeight: "700" as const, letterSpacing: -0.1 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "400" as const },
  label: { fontSize: 13, lineHeight: 16, fontWeight: "600" as const, letterSpacing: 0.2 },
  caption: { fontSize: 11, lineHeight: 14, fontWeight: "600" as const, letterSpacing: 0.3 },
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

/** RN shadow props (iOS) — soft + directional, no neon glow per brand rule. */
export const elevation = {
  sm: {
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  lg: {
    shadowColor: "#000",
    shadowOpacity: 0.36,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
} as const;

export const motion = {
  springSnappy: { damping: 18, stiffness: 220, mass: 0.9 },
  springSoft: { damping: 20, stiffness: 140, mass: 1 },
} as const;

export const theme = { colors, radii, type, elevation, motion } as const;
