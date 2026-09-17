/**
 * Public handles — every account gets a stable, renameable public handle at
 * creation ("finder-<8hex>"), safe to show next to a leaderboard row or a
 * first-capture badge — never an email or raw user id. Foundation for the
 * leaderboard and first-capture attribution (see packages/design/BRAND.md's
 * "early spotter" — not built here, just the identity string).
 *
 * Pure helpers only. Storage + uniqueness + rate limiting live in store.ts
 * alongside the rest of the `users` record (mirrors how entitlements.ts adds
 * columns to `users` but keeps its own logic file).
 */

/** Rename format: lowercase letters, digits, hyphens, 3–20 chars. */
export const HANDLE_FORMAT = /^[a-z0-9-]{3,20}$/;

/** One successful rename per account per this window. */
export const HANDLE_RENAME_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function isValidHandleFormat(handle: string): boolean {
  return HANDLE_FORMAT.test(handle);
}

/** "finder-<8 hex chars>", crypto-random. Always matches HANDLE_FORMAT. */
export function generateHandle(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `finder-${hex}`;
}

export type HandleRenameErrorCode = "invalid_format" | "handle_taken" | "rate_limited";

export type RenameHandleResult =
  | { ok: true; handle: string }
  | { ok: false; code: "invalid_format"; error: string }
  | { ok: false; code: "handle_taken"; error: string }
  | { ok: false; code: "rate_limited"; error: string; retryAfterSec: number };
