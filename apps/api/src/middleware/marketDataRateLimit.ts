import type { MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";
import { sessionSigningKey } from "../lib/env.js";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const LIMIT = 60;
const WINDOW_MS = 60_000;

function edgeIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return (
    c.req.header("cf-connecting-ip")?.trim() ||
    c.req.header("x-real-ip")?.trim() ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "anonymous"
  );
}

async function trustedKey(c: {
  req: { header: (name: string) => string | undefined };
}): Promise<string> {
  const header = c.req.header("Authorization") ?? c.req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    try {
      const payload = (await verify(
        header.slice(7).trim(),
        sessionSigningKey(),
        "HS256",
      )) as Record<string, unknown>;
      if (payload.purpose === "session" && typeof payload.sub === "string" && payload.sub) {
        return `u:${payload.sub}`;
      }
    } catch {
      // Invalid bearer tokens use the edge identity instead of creating buckets.
    }
  }
  return `ip:${edgeIp(c)}`;
}

/**
 * Provider-cost limiter. It deliberately ignores X-Device-Id because that
 * header is client-controlled and can otherwise create an unlimited number of
 * global limiter buckets.
 */
export const marketDataRateLimit: MiddlewareHandler = async (c, next) => {
  const key = await trustedKey(c);
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  const remaining = Math.max(0, LIMIT - bucket.count);
  c.header("X-Market-Data-RateLimit-Limit", String(LIMIT));
  c.header("X-Market-Data-RateLimit-Remaining", String(remaining));
  if (bucket.count > LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: "market data rate limit exceeded", retryAfter }, 429);
  }
  await next();
};

/** Test-only helper. */
export function __resetMarketDataRateLimit(): void {
  buckets.clear();
}
