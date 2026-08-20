/**
 * Shared Derivation Research Console client helpers.
 * Production requires service tokens + Cloudflare front-door host attestation
 * (see option_derivation research-console request-guard).
 */

export const DERIVATION_URL = (
  process.env.DERIVATION_URL ?? "https://derivation-research-console-production.up.railway.app"
).replace(/\/$/, "");

export const DERIVATION_FORWARDED_HOST =
  process.env.RESEARCH_CONSOLE_FORWARDED_HOST ?? "derivation-research-jawaun.jtbx.workers.dev";

function readToken(): string | undefined {
  return process.env.RESEARCH_CONSOLE_SERVICE_TOKEN_READ?.trim() || undefined;
}

function mutateToken(): string | undefined {
  return process.env.RESEARCH_CONSOLE_SERVICE_TOKEN_MUTATE?.trim() || readToken() || undefined;
}

/** Headers for GET /api/idea-chats (read scope). */
export function derivationReadHeaders(extra: Record<string, string> = {}): HeadersInit {
  const token = readToken();
  return {
    Accept: "application/json",
    "x-research-console-forwarded-host": DERIVATION_FORWARDED_HOST,
    "x-forwarded-proto": "https",
    Origin: `https://${DERIVATION_FORWARDED_HOST}`,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

/** Headers for POST /api/idea-chats/stream (mutate scope). */
export function derivationMutateHeaders(extra: Record<string, string> = {}): HeadersInit {
  const token = mutateToken();
  return {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "x-research-console-forwarded-host": DERIVATION_FORWARDED_HOST,
    "x-forwarded-proto": "https",
    Origin: `https://${DERIVATION_FORWARDED_HOST}`,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}
