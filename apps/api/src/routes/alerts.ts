import { getQuote } from "@mapvest/finance";
import { Hono } from "hono";
import {
  type Alert,
  type AlertKind,
  createAlert,
  deleteAlert,
  isAlertTriggered,
  listActiveAlerts,
  listAlerts,
  markTriggered,
} from "../lib/alerts-store.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { bearerAuth, type AuthEnv } from "../middleware/bearerAuth.js";

/**
 * Per-user price alerts.
 *
 * Auth-required CRUD (`POST /`, `GET /`, `DELETE /:id`) plus the poll-on-open
 * endpoint (`GET /check`) that scans every active alert against a fresh quote
 * from `@mapvest/finance` and returns only the alerts that flipped this call.
 *
 * Delegates persistence to `../lib/alerts-store.js` (Postgres when
 * POSTGRES_URL is set; in-memory otherwise — same fallback shape as watchlist).
 */

const VALID_KINDS: readonly AlertKind[] = ["price_above", "price_below", "pct_move"];

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

function normalizeTicker(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

const alerts = new Hono<AuthEnv>();
alerts.use("*", bearerAuth);

/** POST /v1/alerts  { ticker, kind, threshold, note? } → { alert } */
alerts.post("/", async (c) => {
  return safeExecuteWithSpan("http.alerts.create", async (span) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      ticker?: unknown;
      kind?: unknown;
      threshold?: unknown;
      note?: unknown;
    };
    const ticker = normalizeTicker(body.ticker);
    if (!ticker) return c.json({ error: "ticker required" }, 400);

    const kind = typeof body.kind === "string" ? (body.kind as AlertKind) : null;
    if (!kind || !VALID_KINDS.includes(kind)) {
      return c.json({ error: `kind must be one of ${VALID_KINDS.join(", ")}` }, 400);
    }
    const threshold =
      typeof body.threshold === "number"
        ? body.threshold
        : Number.parseFloat(String(body.threshold ?? ""));
    if (!Number.isFinite(threshold)) {
      return c.json({ error: "threshold must be a finite number" }, 400);
    }
    const note =
      typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 240) : undefined;

    const user = c.get("user");
    const alert = await createAlert(user.id, { ticker, kind, threshold, note });
    span.setAttributes({
      user_id: user.id,
      ticker,
      kind,
      threshold,
      has_note: Boolean(note),
    });
    return c.json({ alert });
  });
});

/** GET /v1/alerts → { alerts: Alert[] } */
alerts.get("/", async (c) => {
  return safeExecuteWithSpan("http.alerts.list", async (span) => {
    const user = c.get("user");
    const items = await listAlerts(user.id);
    span.setAttributes({
      user_id: user.id,
      alert_count: items.length,
      active_count: items.filter((a) => !a.disabled && !a.triggeredAt).length,
    });
    return c.json({ alerts: items });
  });
});

/**
 * GET /v1/alerts/check
 *
 * Poll endpoint the mobile client hits on foreground. Iterates every active
 * (not disabled, not-yet-triggered) alert for the user, fetches a fresh quote
 * per unique ticker (deduped via a per-request cache), and marks any that now
 * satisfy their threshold. Returns ONLY the alerts that flipped on this call —
 * clients diff against locally-remembered ids to surface UI badges.
 *
 * Quote failures are treated as "no signal" — an alert is never marked
 * triggered on missing data. Yahoo's endpoint is already best-effort +
 * memoized in @mapvest/finance, so a slow upstream can't wedge this route.
 */
alerts.get("/check", async (c) => {
  return safeExecuteWithSpan("http.alerts.check", async (span) => {
    const user = c.get("user");
    const active = await listActiveAlerts(user.id);
    span.setAttributes({ user_id: user.id, active_count: active.length });

    if (active.length === 0) return c.json({ triggered: [] as Alert[] });

    const uniqueTickers = [...new Set(active.map((a) => a.ticker))];
    const quotes = new Map<string, Awaited<ReturnType<typeof getQuote>>>();
    await Promise.all(
      uniqueTickers.map(async (t) => {
        const q = await getQuote(t).catch(() => null);
        quotes.set(t, q);
      }),
    );

    const triggered: Alert[] = [];
    for (const alert of active) {
      const q = quotes.get(alert.ticker);
      if (!q) continue;
      if (!isAlertTriggered(alert, q)) continue;
      const updated = await markTriggered(user.id, alert.id);
      if (updated?.triggeredAt) triggered.push(updated);
    }
    span.setAttributes({
      ticker_count: uniqueTickers.length,
      triggered_count: triggered.length,
    });
    return c.json({ triggered });
  });
});

/** DELETE /v1/alerts/:id → 204 */
alerts.delete("/:id", async (c) => {
  return safeExecuteWithSpan("http.alerts.delete", async (span) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const removed = await deleteAlert(user.id, id);
    span.setAttributes({ user_id: user.id, alert_id: id, removed });
    if (!removed) return c.json({ error: "not found" }, 404);
    return c.body(null, 204);
  });
});

export default alerts;
