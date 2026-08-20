import { getQuote, resolveComparable } from "@mapvest/finance";
import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { OUTAGE_BRIEF, generateWatchlistBrief } from "../lib/watchlist-brief.js";
import {
  type WatchEntry,
  attachWatchMemo,
  createWatchList,
  deleteWatchList,
  ensureDefaultList,
  listWatchEntries,
  listWatchLists,
  moveWatchEntry,
  removeWatchEntry,
  renameWatchList,
  upsertWatchEntry,
} from "../lib/watchlist-store.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

/**
 * Per-user watchlist. Persisted in Postgres when POSTGRES_URL is set
 * (Railway); in-memory fallback for local tests. All routes require a
 * bearer session.
 *
 * Multiple-watchlists (v2): a user has one or more named lists. Tickers
 * belong to exactly one list (primary key `(user_id, ticker)`). Legacy
 * single-list users are transparently migrated to a "Default" list on
 * their first `GET /lists` — see `ensureDefaultList` in the store.
 */

export type { WatchEntry };

const watchlist = new Hono<AuthEnv>();
watchlist.use("*", bearerAuth);

// ---------- Lists CRUD ----------
// Routes that live UNDER /lists are declared BEFORE `/:ticker` so Hono's
// router doesn't accidentally match "lists" as a ticker symbol.

/** GET /v1/watchlist/lists → { lists: [{ id, name, isDefault, tickerCount }] } */
watchlist.get("/lists", async (c) => {
  return safeExecuteWithSpan("http.watchlist.lists.list", async (span) => {
    const user = c.get("user");
    const lists = await listWatchLists(user.id);
    span.setAttributes({ user_id: user.id, lists_count: lists.length });
    return c.json({
      lists: lists.map((l) => ({
        id: l.id,
        name: l.name,
        isDefault: l.isDefault,
        tickerCount: l.tickerCount,
        createdAt: l.createdAt,
      })),
    });
  });
});

/** POST /v1/watchlist/lists  { name } → { list } */
watchlist.post("/lists", async (c) => {
  return safeExecuteWithSpan("http.watchlist.lists.create", async (span) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    const name = (body.name ?? "").toString().trim();
    if (!name) return c.json({ error: "name required" }, 400);
    const user = c.get("user");
    // Guarantee a default first so the created list is never the only list.
    await ensureDefaultList(user.id);
    const list = await createWatchList(user.id, name);
    span.setAttributes({ user_id: user.id, list_id: list.id });
    return c.json({
      list: {
        id: list.id,
        name: list.name,
        isDefault: list.isDefault,
        tickerCount: 0,
        createdAt: list.createdAt,
      },
    });
  });
});

/** PATCH /v1/watchlist/lists/:id  { name? } → { list } */
watchlist.patch("/lists/:id", async (c) => {
  return safeExecuteWithSpan("http.watchlist.lists.rename", async (span) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    const name = (body.name ?? "").toString().trim();
    if (!name) return c.json({ error: "name required" }, 400);
    const user = c.get("user");
    const list = await renameWatchList(user.id, id, name);
    if (!list) return c.json({ error: "list not found" }, 404);
    span.setAttributes({ user_id: user.id, list_id: list.id });
    return c.json({
      list: {
        id: list.id,
        name: list.name,
        isDefault: list.isDefault,
        createdAt: list.createdAt,
      },
    });
  });
});

/** DELETE /v1/watchlist/lists/:id — 204; 400 when default list */
watchlist.delete("/lists/:id", async (c) => {
  return safeExecuteWithSpan("http.watchlist.lists.delete", async (span) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const res = await deleteWatchList(user.id, id);
    span.setAttributes({ user_id: user.id, list_id: id, ok: res.ok });
    if (res.ok) return c.body(null, 204);
    if (res.reason === "default") {
      return c.json({ error: "cannot delete default list" }, 400);
    }
    return c.json({ error: "list not found" }, 404);
  });
});

// ---------- List summary (sector composition + backtest readiness) ----------

/**
 * GET /v1/watchlist/list-summary?listId=<id>
 * → {
 *      sectors: [{ sector, count, pct }],
 *      backtestReady: boolean,
 *      tickerCount: number,
 *      updatedAt: string
 *    }
 *
 * Groups the list's tickers by sector. Uses whatever sector is stored on
 * the watchlist row; any ticker without a stored sector is grouped under
 * "Uncategorized". Never 500s — an internal error returns an empty payload.
 */
watchlist.get("/list-summary", async (c) => {
  return safeExecuteWithSpan("http.watchlist.list_summary", async (span) => {
    const user = c.get("user");
    const listIdParam = c.req.query("listId");
    const listId = listIdParam || (await ensureDefaultList(user.id)).id;
    try {
      const items = await listWatchEntries(user.id, listId);
      const counts = new Map<string, number>();
      for (const it of items) {
        const key = (it.sector ?? "").trim() || "Uncategorized";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const total = items.length;
      const sectors = [...counts.entries()]
        .map(([sector, count]) => ({
          sector,
          count,
          pct: total > 0 ? count / total : 0,
        }))
        .sort((a, b) => b.count - a.count);
      span.setAttributes({
        user_id: user.id,
        list_id: listId,
        ticker_count: total,
        sectors_count: sectors.length,
      });
      return c.json({
        sectors,
        backtestReady: total > 0,
        tickerCount: total,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      span.recordException(err);
      // Never 500 the client — return an empty payload so the UI can render.
      return c.json({
        sectors: [],
        backtestReady: false,
        tickerCount: 0,
        updatedAt: new Date().toISOString(),
      });
    }
  });
});

// ---------- Move ticker between lists ----------

/** POST /v1/watchlist/move  { ticker, fromListId?, toListId } → 204 */
watchlist.post("/move", async (c) => {
  return safeExecuteWithSpan("http.watchlist.move", async (span) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      ticker?: string;
      fromListId?: string;
      toListId?: string;
    };
    const ticker = (body.ticker ?? "").toString().trim().toUpperCase();
    const toListId = (body.toListId ?? "").toString().trim();
    if (!ticker || !toListId) {
      return c.json({ error: "ticker + toListId required" }, 400);
    }
    const user = c.get("user");
    const entry = await moveWatchEntry(user.id, ticker, toListId);
    span.setAttributes({
      user_id: user.id,
      ticker,
      to_list_id: toListId,
      moved: !!entry,
    });
    if (!entry) return c.json({ error: "ticker not in watchlist" }, 404);
    return c.body(null, 204);
  });
});

// ---------- Existing entries API (list-aware) ----------

/**
 * GET /v1/watchlist[?listId=<id>] → { items: WatchEntry[] }
 * When `listId` is omitted, returns the user's default list.
 */
watchlist.get("/", async (c) => {
  return safeExecuteWithSpan("http.watchlist.list", async (span) => {
    const user = c.get("user");
    const listIdParam = c.req.query("listId");
    const items = await listWatchEntries(user.id, listIdParam || undefined);
    span.setAttributes({
      user_id: user.id,
      items_count: items.length,
      list_id: listIdParam ?? "default",
    });
    return c.json({ items });
  });
});

/**
 * GET /v1/watchlist/brief → { headline, body, generatedAt }
 *
 * FT-style daily column on the user's watchlist. Cached per-user-per-day so
 * repeat opens on the same UTC day are free. On any LLM outage we still
 * return 200 with the OUTAGE_BRIEF so clients don't need error-path UI.
 */
watchlist.get("/brief", async (c) => {
  return safeExecuteWithSpan("http.watchlist.brief", async (span) => {
    const user = c.get("user");
    const entries = await listWatchEntries(user.id);
    span.setAttributes({
      user_id: user.id,
      items_count: entries.length,
      empty: entries.length === 0,
    });
    try {
      const brief = await generateWatchlistBrief({ userId: user.id, entries });
      span.setAttribute("fallback", false);
      return c.json(brief);
    } catch (err) {
      span.recordException(err);
      span.setAttribute("fallback", true);
      return c.json({
        ...OUTAGE_BRIEF,
        generatedAt: new Date().toISOString(),
      });
    }
  });
});

/**
 * POST /v1/watchlist/add  { ticker, name?, sector?, source?, listId? } → { entry, unresolved? }
 *
 * Ticker validation: try to confirm the symbol exists via getQuote() OR via
 * resolveComparable() (in case the user typed a brand name). If neither
 * succeeds, we STILL allow the add — the user may know about a symbol our
 * cache hasn't seen — and flag `unresolved: true` so the client can surface
 * an "unverified" chip.
 */
watchlist.post("/add", async (c) => {
  return safeExecuteWithSpan("http.watchlist.add", async (span) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<WatchEntry> & {
      listId?: string;
    };
    const ticker = (body.ticker ?? "").toString().trim().toUpperCase();
    if (!ticker) return c.json({ error: "ticker required" }, 400);
    const user = c.get("user");

    // Best-effort validation. Both calls are bounded (getQuote 30s cache;
    // resolveComparable is heavier) — we race a short timeout so a slow
    // resolve doesn't hold the request.
    let resolvedName = body.name;
    const resolvedSector = body.sector;
    let unresolved = true;
    try {
      const quote = await Promise.race([
        getQuote(ticker),
        new Promise<null>((r) => setTimeout(() => r(null), 3500)),
      ]);
      if (quote) unresolved = false;
    } catch {
      /* fall through to resolveComparable */
    }
    if (unresolved) {
      try {
        const comps = await Promise.race([
          resolveComparable(ticker),
          new Promise<[]>((r) => setTimeout(() => r([]), 3500)),
        ]);
        if (Array.isArray(comps) && comps.length > 0) {
          unresolved = false;
          const first = comps[0]!;
          resolvedName = resolvedName ?? first.name;
        }
      } catch {
        /* leave unresolved=true — we still add the entry below */
      }
    }

    const entry = await upsertWatchEntry(user.id, {
      ticker,
      name: resolvedName,
      sector: resolvedSector,
      source: (body.source as WatchEntry["source"]) ?? "manual",
      listId: body.listId,
    });
    span.setAttributes({
      user_id: user.id,
      ticker,
      source: entry.source,
      list_id: entry.listId ?? "default",
      unresolved,
    });
    return c.json({ entry, unresolved });
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
