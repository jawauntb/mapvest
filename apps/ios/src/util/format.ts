/**
 * Shared number formatting for the app UI.
 *
 * Every screen used to grow its own `formatMoney` / `formatPercent` helper,
 * which is how the detail sheet ended up printing a market cap as
 * "3410000000000". This module is the single source of truth: `Intl.NumberFormat`
 * under the hood, `"—"` for anything that isn't a finite number, and the same
 * rounding taste as `src/chartkit/scale.ts` (which stays independent on purpose —
 * chartkit formats axis ticks and must not depend on UI code, and this module
 * must not depend on chartkit).
 */

/** Em dash used for "no value" everywhere in the app. */
export const EM_DASH = "—";

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// `Intl.NumberFormat` construction is expensive on Hermes, and these formatters
// are called once per table cell. Memoize on the option shape.
const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const made = new Intl.NumberFormat("en-US", options);
  formatterCache.set(key, made);
  return made;
}

export type MoneyOptions = {
  /** Fraction digits, fixed (min === max). Default 2. */
  dp?: number;
  /** Render a leading "+" for positive values. Default false. */
  sign?: boolean;
  /** ISO currency code. Default "USD". */
  currency?: string;
};

/** 179.04 → "$179.04"; 1234.5 → "$1,234.50"; null → "—". */
export function formatMoney(value: number | null | undefined, opts: MoneyOptions = {}): string {
  if (!isFiniteNumber(value)) return EM_DASH;
  const dp = opts.dp ?? 2;
  return formatter({
    style: "currency",
    currency: opts.currency ?? "USD",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
    ...(opts.sign ? { signDisplay: "exceptZero" as const } : null),
  }).format(value);
}

/**
 * Market-cap / volume style shorthand at three significant digits:
 * 3.41e12 → "3.41T", 1.25e10 → "12.5B", 9.8e8 → "980M", 45_200 → "45.2K".
 * Values under 1,000 print plainly ("999"). null/NaN → "—".
 */
export function formatCompact(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return EM_DASH;
  try {
    const out = formatter({
      notation: "compact",
      compactDisplay: "short",
      maximumSignificantDigits: 3,
    }).format(value);
    // Some Hermes builds accept `notation` and then ignore it. If the result is
    // still a long digit run, fall through to the manual scale below.
    if (Math.abs(value) < 1000 || /[KMBT]$/.test(out)) return out;
  } catch {
    // Intl without compact-notation support — use the manual scale.
  }
  return compactFallback(value);
}

const COMPACT_UNITS: Array<[number, string]> = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

function compactFallback(value: number): string {
  const abs = Math.abs(value);
  for (const [factor, suffix] of COMPACT_UNITS) {
    if (abs >= factor) return `${threeSigDigits(value / factor)}${suffix}`;
  }
  return threeSigDigits(value);
}

/** 3.4100 → "3.41", 12.50 → "12.5", 980.4 → "980" (trailing zeros dropped). */
function threeSigDigits(value: number): string {
  const abs = Math.abs(value);
  const dp = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toFixed(dp).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1");
}

export type PctOptions = {
  /** Fraction digits, fixed (min === max). Default 1. */
  dp?: number;
  /** Render a leading "+" for positive values. Default false. */
  sign?: boolean;
};

/**
 * Fraction → percent string: 0.123 → "12.3%". Pass `{ sign: true }` for
 * "+12.3%" on gains. null/NaN → "—".
 */
export function formatPct(value: number | null | undefined, opts: PctOptions = {}): string {
  if (!isFiniteNumber(value)) return EM_DASH;
  const dp = opts.dp ?? 1;
  return formatter({
    style: "percent",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
    ...(opts.sign ? { signDisplay: "exceptZero" as const } : null),
  }).format(value);
}

export type DecimalOptions = {
  /** Thousands separators. Default true. */
  grouping?: boolean;
  /** Render a leading "+" for positive values. Default false. */
  sign?: boolean;
};

/** 35.1234 → "35.12"; formatDecimal(1234, 0) → "1,234"; null → "—". */
export function formatDecimal(
  value: number | null | undefined,
  dp = 2,
  opts: DecimalOptions = {},
): string {
  if (!isFiniteNumber(value)) return EM_DASH;
  return formatter({
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
    useGrouping: opts.grouping ?? true,
    ...(opts.sign ? { signDisplay: "exceptZero" as const } : null),
  }).format(value);
}
