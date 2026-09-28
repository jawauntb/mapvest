/**
 * Shared utility functions to reduce code duplication across routes and lib files.
 * Includes string normalization and telemetry helpers.
 */

// Telemetry & Performance

/**
 * Measure elapsed time in milliseconds since `startTime` from performance.now().
 * Useful for span telemetry: `span.setAttribute("latency_ms", elapsedMs(started))`
 */
export function elapsedMs(startTime: number): number {
  return Math.round(performance.now() - startTime);
}

/**
 * Normalize a ticker symbol: trim whitespace and convert to uppercase.
 * Returns null for empty or null input.
 */
export function normalizeTicker(input: string | undefined | null): string | null {
  if (!input) return null;
  const t = input.trim().toUpperCase();
  return t.length > 0 ? t : null;
}

/**
 * Normalize a string: trim whitespace and convert to uppercase.
 * Never returns null; returns empty string for null/undefined input.
 */
export function normalizeUppercase(input: string | undefined | null): string {
  if (!input) return "";
  return input.trim().toUpperCase();
}

/**
 * Trim and lowercase a string.
 */
export function normalizeLowercase(input: string | undefined | null): string {
  if (!input) return "";
  return input.trim().toLowerCase();
}

/**
 * Simple trim without case changes.
 */
export function normalizeTrim(input: string | undefined | null): string {
  return (input ?? "").trim();
}

/**
 * Check if a string is a valid ticker symbol.
 * Valid if it's non-empty and matches standard ticker pattern.
 */
export function isValidTicker(ticker: string | undefined | null): boolean {
  if (!ticker) return false;
  const normalized = normalizeTicker(ticker);
  return normalized !== null && normalized.length > 0 && normalized.length <= 5;
}
