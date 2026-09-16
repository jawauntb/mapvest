/**
 * Finds journal — every successful /v1/identify by a signed-in user records
 * its top investable server-side (see routes/identify.ts). Guests keep a
 * local journal and replay it here after sign-in.
 *
 * Routes (bearer-required):
 *   GET  /v1/finds?limit=100 → { finds: Find[], count } newest-first
 *   POST /v1/finds           → { finds, count } after recording the batch
 */
import { type FindsResponse, RecordFindsRequest } from "@mapvest/core";
import { seedBrands } from "@mapvest/finance";
import { Hono } from "hono";
import { stampFindList } from "../lib/dex.js";
import { listFinds, recordFind } from "../lib/finds-store.js";
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
    const items = stampFindList(await listFinds(user.id, limit), seedBrands);
    span.setAttributes({ user_id: user.id, count: items.length });
    const resp: FindsResponse = { finds: items, count: items.length };
    return c.json(resp);
  });
});

finds.post("/", async (c) => {
  return safeExecuteWithSpan("http.finds.record", async (span) => {
    const user = c.get("user");
    const raw = await c.req.json().catch(() => null);
    const parsed = RecordFindsRequest.safeParse(raw);
    if (!parsed.success) return c.json({ error: "finds required" }, 400);

    for (const find of parsed.data.finds) {
      await recordFind(user.id, find);
    }
    const items = stampFindList(await listFinds(user.id, DEFAULT_LIMIT), seedBrands);
    span.setAttributes({
      user_id: user.id,
      posted_count: parsed.data.finds.length,
      count: items.length,
    });
    const resp: FindsResponse = { finds: items, count: items.length };
    return c.json(resp);
  });
});

export default finds;
