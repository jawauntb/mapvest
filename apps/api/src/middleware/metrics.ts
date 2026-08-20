import type { User } from "@mapvest/core";
import type { MiddlewareHandler } from "hono";
import { record } from "../lib/metrics.js";

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
 * Records latency + status for every request into the in-memory ring buffer.
 * Attach as an app-level middleware so /v1/admin/metrics has data.
 */
export const metricsMiddleware: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  try {
    await next();
  } finally {
    const ms = Math.round(performance.now() - start);
    const user = (c as unknown as { get: (k: string) => User | undefined }).get("user");
    record({
      ts: new Date().toISOString(),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      ms,
      userId: user?.id,
      ip: clientIp(c),
    });
  }
};
