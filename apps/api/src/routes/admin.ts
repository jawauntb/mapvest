import { Hono } from "hono";
import { listUsers } from "../lib/store.js";
import { stats, tail } from "../lib/metrics.js";
import { bearerAuth, type AuthEnv } from "../middleware/bearerAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const admin = new Hono<AuthEnv>();

admin.use("*", bearerAuth, requireAdmin);

/**
 * GET /v1/admin/metrics
 * Aggregate request counts + p95 latency across the ring buffer.
 */
admin.get("/metrics", (c) => {
  return c.json(stats());
});

/**
 * GET /v1/admin/users
 * List of registered users (id, email, scopes, createdAt).
 */
admin.get("/users", (c) => {
  return c.json({ users: listUsers() });
});

/**
 * GET /v1/admin/log?limit=100
 * Tail of the in-memory request log.
 */
admin.get("/log", (c) => {
  const limit = Number(c.req.query("limit") ?? 100);
  const clamped = Number.isFinite(limit) ? Math.max(1, Math.min(500, limit)) : 100;
  return c.json({ entries: tail(clamped) });
});

export default admin;
