/**
 * Finds journal — every successful /v1/identify by a signed-in user records
 * its top investable server-side (see routes/identify.ts).
 *
 * Routes (bearer-required):
 *   GET /v1/finds?limit=100 → { finds: Find[], count } newest-first
 */
import type { FindsResponse } from "@mapvest/core";
import { Hono } from "hono";
import { listFinds } from "../lib/finds-store.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

const finds = new Hono<AuthEnv>();
finds.use("*", bearerAuth);

finds.get("/", async (c) => {
  return safeExecuteWithSpan("http.finds.list", async (span) => {
    const user = c.get("user");
    const rawLimit = Number(c.req.query("limit") ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const items = await listFinds(user.id, limit);
    span.setAttributes({ user_id: user.id, count: items.length });
    const resp: FindsResponse = { finds: items, count: items.length };
    return c.json(resp);
  });
});

export default finds;
