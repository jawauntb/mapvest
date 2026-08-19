import type { MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";
import { sessionSigningKey } from "../lib/env.js";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type RateLimitOpts = {
  /** Requests per window, default 300. */
  limit?: number;
  /** Window length in ms, default 60_000. */
  windowMs?: number;
};

const SKIP_PATHS = new Set(["/v1/health", "/v1/config"]);

function clientIp(c: {
  req: { header: (n: string) => string | undefined };
}): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    c.req.header("cf-connecting-ip") ||
    "unknown"
  );
}

function pathname(c: { req: { path: string; url: string } }): string {
  if (c.req.path) return c.req.path;
  try {
    return new URL(c.req.url).pathname;
  } catch {
    return "";
  }
}

function shouldSkip(c: { req: { method: string; path: string; url: string } }): boolean {
  const method = c.req.method.toUpperCase();
  if (method === "OPTIONS" || method === "HEAD") return true;
  const path = pathname(c);
  if (SKIP_PATHS.has(path)) return true;
  if (path.startsWith("/v1/billing/webhook")) return true;
  return false;
}

/**
 * Prefer a signed session subject, then the client device id, then IP.
 * Auth middleware is mounted per-route *after* this global limiter, so we
 * read the bearer token here instead of waiting for `c.get("user")`.
 */
async function bucketKey(c: {
  req: { header: (n: string) => string | undefined };
}): Promise<string> {
  const header = c.req.header("Authorization") ?? c.req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    try {
      const payload = (await verify(token, sessionSigningKey(), "HS256")) as Record<
        string,
        unknown
      >;
      if (payload.purpose === "session" && typeof payload.sub === "string" && payload.sub) {
        return `u:${payload.sub}`;
      }
    } catch {
      /* invalid token — fall through */
    }
  }
  const device = c.req.header("x-device-id") ?? c.req.header("X-Device-Id");
  if (device?.trim()) return `d:${device.trim()}`;
  return `ip:${clientIp(c)}`;
}

/**
 * Per-user / per-device / per-IP bucket. Default 300 requests per minute —
 * enough for Home's quote fan-out plus an Investable open, without letting
 * a single IP starve every signed-in session behind the same NAT.
 *
 * OPTIONS/HEAD, health, and the Stripe webhook do not count.
 *
 * Bucket lives in-memory — good enough for a single-instance API. When we
 * scale horizontally we swap this for Redis / Upstash.
 */
export function rateLimit(opts: RateLimitOpts = {}): MiddlewareHandler {
  const limit = opts.limit ?? 300;
  const windowMs = opts.windowMs ?? 60_000;

  return async (c, next) => {
    if (shouldSkip(c)) {
      await next();
      return;
    }

    const key = await bucketKey(c);
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    const remaining = Math.max(0, limit - b.count);
    const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(b.resetAt / 1000)));
    if (b.count > limit) {
      c.header("Retry-After", String(retryAfterSec));
      return c.json({ error: "rate limit exceeded", retryAfter: retryAfterSec }, 429);
    }
    await next();
  };
}

/** Test-only helper. */
export function __resetRateLimit() {
  buckets.clear();
}
