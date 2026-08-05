// EXPO_PUBLIC_* env vars are inlined by the Expo bundler at build time.
// Defaults are for local dev against the API service on port 3001.

export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

export const IS_DEV = __DEV__;
