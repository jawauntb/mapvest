import { Hono } from "hono";
import { costSummary, costTail } from "../lib/costTelemetry.js";
import { getEntitlementState, setFreeForever } from "../lib/entitlements.js";
import { stats, tail } from "../lib/metrics.js";
import { getUserById, listUsers } from "../lib/store.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const admin = new Hono<AuthEnv>();

admin.use("*", bearerAuth, requireAdmin);

/**
 * GET /v1/admin/metrics
 * Aggregate request counts + p95 latency across the ring buffer, plus
 * cost telemetry (OpenRouter tokens per model, Exa hits).
 */
admin.get("/metrics", (c) => {
  return c.json({
    ...stats(),
    cost: costSummary(),
  });
});

/**
 * GET /v1/admin/cost?limit=100
 * Recent per-request cost breakdown (OpenRouter usage, Exa hits).
 */
admin.get("/cost", (c) => {
  const limit = Number(c.req.query("limit") ?? 100);
  const clamped = Number.isFinite(limit) ? Math.max(1, Math.min(500, limit)) : 100;
  return c.json({
    summary: costSummary(),
    entries: costTail(clamped),
  });
});

/**
 * GET /v1/admin/users
 * List of registered users (id, email, scopes, createdAt).
 */
admin.get("/users", async (c) => {
  return c.json({ users: await listUsers() });
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

/**
 * POST /v1/admin/users/:id/entitlement
 * Body: { freeForever: boolean, reason?: string }
 * Manual override — grants or revokes unlimited free usage for a user,
 * independent of the automatic jawaun-email / admin-scope grant.
 */
admin.post("/users/:id/entitlement", async (c) => {
  const id = c.req.param("id");
  const target = await getUserById(id);
  if (!target) return c.json({ error: "user not found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as {
    freeForever?: unknown;
    reason?: unknown;
  };
  if (typeof body.freeForever !== "boolean") {
    return c.json({ error: "freeForever (boolean) required" }, 400);
  }
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : undefined;

  await setFreeForever(target.id, body.freeForever, reason);
  const entitlement = await getEntitlementState({ userId: target.id, email: target.email });
  return c.json({ ok: true, userId: target.id, entitlement });
});

export default admin;
