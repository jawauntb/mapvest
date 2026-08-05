/**
 * Atlas Signal tokens for React Native.
 * Mirror of @mapvest/design — keep in sync with packages/design/src/tokens.ts.
 */

export const colors = {
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
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 22,
} as const;

export const theme = { colors, radii } as const;
