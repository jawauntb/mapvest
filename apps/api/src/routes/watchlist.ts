import { Hono } from "hono";
import { bearerAuth, type AuthEnv } from "../middleware/bearerAuth.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";

/**
 * Per-user watchlist. In-memory for v0.1 — Redis/Postgres when we scale
 * (D11 in docs/SYSTEM_DESIGN.md). All routes require a bearer session.
 *
 * Entries include the ticker, human name, source screen ("camera" | "map"
 * | "list" | "manual"), and any memo saved by the client.
 */

export type WatchEntry = {
  ticker: string;
  name?: string;
  sector?: string;
  source: "camera" | "map" | "list" | "manual" | "detail";
  memo?: string;
  memoProvider?: string;
  createdAt: string; // ISO
};

const perUser = new Map<string, Map<string, WatchEntry>>();

function bucket(userId: string): Map<string, WatchEntry> {
  let m = perUser.get(userId);
  if (!m) {
    m = new Map();
    perUser.set(userId, m);
  }
  return m;
}

const watchlist = new Hono<AuthEnv>();
watchlist.use("*", bearerAuth);

/** GET /v1/watchlist → { items: WatchEntry[] } */
watchlist.get("/", (c) => {
  return safeExecuteWithSpan("http.watchlist.list", (span) => {
    const user = c.get("user");
    const m = bucket(user.id);
    span.setAttributes({ user_id: user.id, items_count: m.size });
    return c.json({ items: [...m.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  });
});

/** POST /v1/watchlist/add  { ticker, name?, sector?, source? } → { entry } */
watchlist.post("/add", async (c) => {
  return safeExecuteWithSpan("http.watchlist.add", async (span) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<WatchEntry>;
    const ticker = (body.ticker ?? "").toString().trim().toUpperCase();
    if (!ticker) return c.json({ error: "ticker required" }, 400);
    const user = c.get("user");
    const entry: WatchEntry = {
      ticker,
      name: body.name,
      sector: body.sector,
      source: (body.source as WatchEntry["source"]) ?? "manual",
      createdAt: new Date().toISOString(),
    };
    bucket(user.id).set(ticker, entry);
    span.setAttributes({ user_id: user.id, ticker, source: entry.source });
    return c.json({ entry });
  });
});

/** DELETE /v1/watchlist/:ticker */
watchlist.delete("/:ticker", (c) => {
  return safeExecuteWithSpan("http.watchlist.remove", (span) => {
    const ticker = c.req.param("ticker").trim().toUpperCase();
    const user = c.get("user");
    const removed = bucket(user.id).delete(ticker);
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
    const m = bucket(user.id);
    const existing = m.get(ticker);
    if (!existing) return c.json({ error: "ticker not in watchlist" }, 404);
    existing.memo = body.memo;
    existing.memoProvider = body.provider;
    span.setAttributes({ user_id: user.id, ticker, memo_len: body.memo.length });
    return c.json({ entry: existing });
  });
});

export default watchlist;
