import type { MiddlewareHandler } from "hono";
import type { User } from "@mapvest/core";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type RateLimitOpts = {
  /** Requests per window, default 60. */
  limit?: number;
  /** Window length in ms, default 60_000. */
  windowMs?: number;
};

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

/**
 * Per-IP + per-user bucket. If a session is present in the context we key on
 * user id, otherwise we key on the client's IP. 60 requests per minute default.
 *
 * Bucket lives in-memory — good enough for a single-instance API. When we scale
 * horizontally we swap this for Redis / Upstash.
 */
export function rateLimit(opts: RateLimitOpts = {}): MiddlewareHandler {
  const limit = opts.limit ?? 60;
  const windowMs = opts.windowMs ?? 60_000;

  return async (c, next) => {
    // c.get("user") may not be typed in every mount point — read defensively.
    const user = (c as unknown as { get: (k: string) => User | undefined }).get("user");
    const key = user ? `u:${user.id}` : `ip:${clientIp(c)}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(Math.max(0, limit - b.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(b.resetAt / 1000)));
    if (b.count > limit) {
      return c.json({ error: "rate limit exceeded" }, 429);
    }
    await next();
  };
}

/** Test-only helper. */
export function __resetRateLimit() {
  buckets.clear();
}
