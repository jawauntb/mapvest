/**
 * Shared helpers for CLI commands.
 *
 * `apiBase()` centralizes the MAPVEST_API_URL default so every command
 * reads the same environment variable and falls back to the production
 * Railway host if nothing is set.
 *
 * `formatQuote()`, `printKeyValue()`, and `printTable()` are the plain-text
 * formatters used by the pretty-print output — no external table library,
 * no ANSI colors (keeps the CLI safe to redirect into files/pipes).
 */

/** Default target if MAPVEST_API_URL is not set. */
export const DEFAULT_API_URL = "https://api-production-4b27.up.railway.app";

/**
 * Resolve the API base URL, trimming a trailing slash so downstream
 * path concatenation stays clean.
 */
export function apiBase(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.MAPVEST_API_URL ?? DEFAULT_API_URL;
  return base.replace(/\/+$/, "");
}

/**
 * Format a signed number with a fixed number of decimals. `+` prefix on
 * positives, no prefix on 0, native `-` on negatives — matches how quote
 * changes are typically rendered in terminals.
 */
export function signed(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return String(n);
  const s = n.toFixed(decimals);
  return n > 0 ? `+${s}` : s;
}

/** Compact currency-agnostic price formatter. */
export function price(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toFixed(decimals);
}

/**
 * Print a two-column key/value block, right-padding keys to a common
 * width so values line up. Uses the passed-in printer so tests can
 * capture output.
 */
export function printKeyValue(
  pairs: Array<[string, string | number | undefined | null]>,
  print: (s: string) => void = console.log,
): void {
  const rows = pairs.filter(([, v]) => v !== undefined && v !== null && v !== "");
  const width = rows.reduce((m, [k]) => Math.max(m, k.length), 0);
  for (const [k, v] of rows) {
    print(`${k.padEnd(width)}  ${String(v)}`);
  }
}

/**
 * Print a rectangular table with a header row. Column widths are derived
 * from the longest cell (including header). Rows are joined with two
 * spaces — enough separation to remain readable when copy-pasted.
 */
export function printTable(
  headers: string[],
  rows: Array<Array<string | number>>,
  print: (s: string) => void = console.log,
): void {
  const widths = headers.map((h, i) => {
    const cellMax = rows.reduce((m, r) => Math.max(m, String(r[i] ?? "").length), 0);
    return Math.max(h.length, cellMax);
  });
  const fmtRow = (r: Array<string | number>) =>
    r.map((c, i) => String(c ?? "").padEnd(widths[i] ?? 0)).join("  ");
  print(fmtRow(headers));
  print(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) print(fmtRow(r));
}

/**
 * Read a subcommand-scoped flag from an args array. Supports both
 * `--flag value` and `--flag=value` forms. Returns `undefined` when
 * absent. Callers coerce (Number, Boolean, etc.) as needed.
 */
export function readFlag(args: string[], name: string): string | undefined {
  const long = `--${name}`;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === long) return args[i + 1];
    if (a?.startsWith(`${long}=`)) return a.slice(long.length + 1);
  }
  return undefined;
}

/**
 * Best-effort JSON parser for API responses. Falls back to `{ error: raw }`
 * so error handlers can always inspect a shape.
 */
export async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text || `HTTP ${res.status}` };
  }
}
