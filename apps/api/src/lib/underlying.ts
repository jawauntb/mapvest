/**
 * Shared helpers for proxying the sibling underlying-analyzer-reboot service.
 */

export const UNDERLYING_URL =
  process.env.UNDERLYING_URL ?? "https://underlying-terminal-production.up.railway.app";

/** yfinance periods used by Underlying Analyzer charts. */
const PERIOD_ALIASES: Record<string, string> = {
  "1m": "1mo",
  "1M": "1mo",
  "1mo": "1mo",
  "3m": "3mo",
  "3M": "3mo",
  "3mo": "3mo",
  "6m": "6mo",
  "6M": "6mo",
  "6mo": "6mo",
  "1y": "1y",
  "1Y": "1y",
  "2y": "2y",
  "2Y": "2y",
  "5y": "5y",
  "5Y": "5y",
  "5d": "5d",
  "1d": "1d",
  max: "max",
};

export function normalizePeriod(raw: string | undefined, fallback = "1mo"): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  return PERIOD_ALIASES[trimmed] ?? PERIOD_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

export function isTicker(sym: string): boolean {
  return /^[A-Z][A-Z0-9.]{0,5}$/.test(sym);
}

export async function upstreamFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 45_000, ...rest } = init;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${UNDERLYING_URL}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(rest.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(t);
  }
}
