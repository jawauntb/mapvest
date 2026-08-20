import type { User } from "@mapvest/core";
import type { MiddlewareHandler } from "hono";
import { record } from "../lib/metrics.js";

/**
 * Guardrails for /v1/identify. Modeled on ./rateLimit.ts but stricter and
 * layered on top of the global limiter:
 *
 *   - Per-user token bucket: 10 requests/minute, 60 requests/hour.
 *     Falls back to per-IP when no session user is on the context.
 *   - Abuse heuristic: if the same user OR the same IP makes more than 30
 *     attempts in a 60-second sliding window, the request is rejected with
 *     429 and an admin log entry is written with tag="suspected_abuse".
 *
 * Attempts are counted BEFORE the token bucket so that a client hammering
 * the endpoint past its rpm cap still trips the abuse flag — otherwise the
 * cheaper rate-limit rejection would mask the abuse pattern.
 *
 * All state lives in-process, matching the existing global limiter. When we
 * scale horizontally this becomes Redis / Upstash.
 */

type Bucket = { count: number; resetAt: number };

const minuteBuckets = new Map<string, Bucket>();
const hourBuckets = new Map<string, Bucket>();

/** Sliding-window timestamps used for the abuse heuristic. */
const recentByUser = new Map<string, number[]>();
const recentByIp = new Map<string, number[]>();

/** Fixed bucket limits. Exported for tests. */
export const IDENTIFY_LIMITS = {
  perMinute: 10,
  perHour: 60,
  abuseWindowMs: 60_000,
  abuseThreshold: 30,
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

function bumpBucket(
  map: Map<string, Bucket>,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): { over: boolean; remaining: number; resetSec: number } {
  let b = map.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    map.set(key, b);
  }
  b.count += 1;
  return {
    over: b.count > limit,
    remaining: Math.max(0, limit - b.count),
    resetSec: Math.ceil(b.resetAt / 1000),
  };
}

function bumpSliding(
  map: Map<string, number[]>,
  key: string,
  now: number,
  windowMs: number,
): number {
  const cutoff = now - windowMs;
  const prior = map.get(key) ?? [];
  const kept = prior.filter((t) => t >= cutoff);
  kept.push(now);
  map.set(key, kept);
  return kept.length;
}

/**
 * Middleware for /v1/identify. Applies the per-user (or per-IP) token
 * bucket and the abuse heuristic described in the module doc.
 */
export const identifyGuards: MiddlewareHandler = async (c, next) => {
  const user = (c as unknown as { get: (k: string) => User | undefined }).get("user");
  const ip = clientIp(c);
  const key = user ? `u:${user.id}` : `ip:${ip}`;
  const now = Date.now();

  // 1. Track attempts unconditionally so abuse detection sees every hit,
  //    including ones the token bucket will reject.
  const userAttempts = user
    ? bumpSliding(recentByUser, user.id, now, IDENTIFY_LIMITS.abuseWindowMs)
    : 0;
  const ipAttempts = bumpSliding(recentByIp, ip, now, IDENTIFY_LIMITS.abuseWindowMs);

  // 2. Abuse heuristic. Log an admin entry so this shows up in
  //    /v1/admin/log for triage.
  if (
    userAttempts > IDENTIFY_LIMITS.abuseThreshold ||
    ipAttempts > IDENTIFY_LIMITS.abuseThreshold
  ) {
    record({
      ts: new Date().toISOString(),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: 429,
      ms: 0,
      userId: user?.id,
      ip,
      tag: "suspected_abuse",
    });
    return c.json({ error: "suspected abuse — try again later" }, 429);
  }

  // 3. Token bucket. Emit dedicated identify headers so callers can
  //    distinguish these limits from the global limiter's headers.
  const minute = bumpBucket(minuteBuckets, key, IDENTIFY_LIMITS.perMinute, 60_000, now);
  const hour = bumpBucket(hourBuckets, key, IDENTIFY_LIMITS.perHour, 3_600_000, now);

  c.header("X-Identify-RateLimit-Minute", String(IDENTIFY_LIMITS.perMinute));
  c.header("X-Identify-RateLimit-Minute-Remaining", String(minute.remaining));
  c.header("X-Identify-RateLimit-Minute-Reset", String(minute.resetSec));
  c.header("X-Identify-RateLimit-Hour", String(IDENTIFY_LIMITS.perHour));
  c.header("X-Identify-RateLimit-Hour-Remaining", String(hour.remaining));
  c.header("X-Identify-RateLimit-Hour-Reset", String(hour.resetSec));

  if (minute.over || hour.over) {
    return c.json({ error: "identify rate limit exceeded" }, 429);
  }

  await next();
};

/** Test-only helper. */
export function __resetIdentifyGuards() {
  minuteBuckets.clear();
  hourBuckets.clear();
  recentByUser.clear();
  recentByIp.clear();
}
