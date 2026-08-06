import { Hono } from "hono";
import { bearerAuth, type AuthEnv } from "../middleware/bearerAuth.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import {
  attachWatchMemo,
  listWatchEntries,
  removeWatchEntry,
  upsertWatchEntry,
  type WatchEntry,
} from "../lib/watchlist-store.js";

/**
 * Per-user watchlist. Persisted in Postgres when POSTGRES_URL is set
 * (Railway); in-memory fallback for local tests. All routes require a
 * bearer session.
 */

export type { WatchEntry };

const watchlist = new Hono<AuthEnv>();
watchlist.use("*", bearerAuth);

/** GET /v1/watchlist → { items: WatchEntry[] } */
watchlist.get("/", async (c) => {
  return safeExecuteWithSpan("http.watchlist.list", async (span) => {
    const user = c.get("user");
    const items = await listWatchEntries(user.id);
    span.setAttributes({ user_id: user.id, items_count: items.length });
    return c.json({ items });
  });
});

/** POST /v1/watchlist/add  { ticker, name?, sector?, source? } → { entry } */
watchlist.post("/add", async (c) => {
  return safeExecuteWithSpan("http.watchlist.add", async (span) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<WatchEntry>;
    const ticker = (body.ticker ?? "").toString().trim().toUpperCase();
    if (!ticker) return c.json({ error: "ticker required" }, 400);
    const user = c.get("user");
    const entry = await upsertWatchEntry(user.id, {
      ticker,
      name: body.name,
      sector: body.sector,
      source: (body.source as WatchEntry["source"]) ?? "manual",
    });
    span.setAttributes({ user_id: user.id, ticker, source: entry.source });
    return c.json({ entry });
  });
});

/** DELETE /v1/watchlist/:ticker */
watchlist.delete("/:ticker", async (c) => {
  return safeExecuteWithSpan("http.watchlist.remove", async (span) => {
    const ticker = c.req.param("ticker").trim().toUpperCase();
    const user = c.get("user");
    const removed = await removeWatchEntry(user.id, ticker);
    span.setAttributes({ user_id: user.id, ticker, removed });
    return c.json({ ok: true, removed });
  });
});

/**
 * POST /v1/watchlist/:ticker/memo  { memo, provider? }
 * Attaches a memo (typically the /v1/memo output) to a saved ticker.
 */
watchlist.post("/:ticker/memo", async (c) => {
  return safeExecuteWithSpan("http.watchlist.memo", async (span) => {
    const ticker = c.req.param("ticker").trim().toUpperCase();
    const body = (await c.req.json().catch(() => ({}))) as {
      memo?: string;
      provider?: string;
    };
    if (!body.memo || body.memo.trim().length < 20) {
      return c.json({ error: "memo required (min 20 chars)" }, 400);
    }
    const user = c.get("user");
    const entry = await attachWatchMemo(user.id, ticker, body.memo, body.provider);
    if (!entry) return c.json({ error: "ticker not in watchlist" }, 404);
    span.setAttributes({ user_id: user.id, ticker, memo_len: body.memo.length });
    return c.json({ entry });
  });
});

export default watchlist;
