// EXPO_PUBLIC_* env vars are inlined by the Expo bundler at build time.
// Defaults are for local dev against the API service on port 3001.

export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * The Underlying Analyzer market-research API (public JSON POST, CORS open,
 * no key). Serves the chart-data endpoints consumed by src/api/underlying.ts.
 */
export const UNDERLYING_API_URL: string =
  process.env.EXPO_PUBLIC_UNDERLYING_API_URL ??
  "https://underlying-terminal-production.up.railway.app";

export const IS_DEV = __DEV__;
