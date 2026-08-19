/** Defensive formatters for chart chrome. Never throw on missing upstream fields. */

export function safeFixed(v: unknown, digits = 2, fallback = "—"): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : fallback;
}

export function safeUpper(v: unknown, fallback = "—"): string {
  return typeof v === "string" && v.length > 0 ? v.toUpperCase() : fallback;
}
