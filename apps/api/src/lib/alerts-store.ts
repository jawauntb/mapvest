/**
 * Per-user price alerts persistence.
 *
 * Postgres when POSTGRES_URL is set; in-memory fallback for local tests. The
 * CREATE TABLE runs inline on first use (`ensureAlertsTable`) so this module
 * is self-contained — no separate migration file. Mirrors the pattern used by
 * `watchlist-store.ts` (memory kept warm alongside the DB for same-process
 * reads) and the schema described in the feature spec:
 *
 *   id            text primary key
 *   user_id       text not null
 *   ticker        text not null
 *   kind          text (price_above | price_below | pct_move)
 *   threshold     double precision
 *   note          text
 *   created_at    timestamptz default now()
 *   triggered_at  timestamptz
 *   disabled      boolean default false
 */
import { dbEnabled, getSql, initDb } from "./db.js";

export type AlertKind = "price_above" | "price_below" | "pct_move";

export type Alert = {
  id: string;
  ticker: string;
  kind: AlertKind;
  threshold: number;
  note?: string;
  createdAt: string; // ISO
  triggeredAt?: string; // ISO
  disabled: boolean;
};

const memory = new Map<string, Map<string, Alert>>();

function memBucket(userId: string): Map<string, Alert> {
  let m = memory.get(userId);
  if (!m) {
    m = new Map();
    memory.set(userId, m);
  }
  return m;
}

let tableReady = false;
async function ensureAlertsTable(): Promise<void> {
  if (tableReady) return;
  await initDb();
  if (!dbEnabled()) {
    tableReady = true;
    return;
  }
  const sql = getSql();
  if (!sql) {
    tableReady = true;
    return;
  }
  await sql`
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('price_above','price_below','pct_move')),
      threshold DOUBLE PRECISION NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      triggered_at TIMESTAMPTZ,
      disabled BOOLEAN NOT NULL DEFAULT false
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS alerts_user_idx ON alerts (user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS alerts_active_idx ON alerts (user_id) WHERE disabled = false AND triggered_at IS NULL`;
  tableReady = true;
}

type Row = {
  id: string;
  ticker: string;
  kind: string;
  threshold: number;
  note: string | null;
  created_at: Date | string;
  triggered_at: Date | string | null;
  disabled: boolean;
};

function rowToAlert(row: Row): Alert {
  const createdAt =
    typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString();
  const triggeredAt =
    row.triggered_at == null
      ? undefined
      : typeof row.triggered_at === "string"
        ? row.triggered_at
        : row.triggered_at.toISOString();
  const alert: Alert = {
    id: row.id,
    ticker: row.ticker,
    kind: row.kind as AlertKind,
    threshold: Number(row.threshold),
    createdAt,
    disabled: row.disabled,
  };
  if (row.note) alert.note = row.note;
  if (triggeredAt) alert.triggeredAt = triggeredAt;
  return alert;
}

function newId(): string {
  // Bun exposes crypto.randomUUID globally.
  return `alt_${crypto.randomUUID()}`;
}

export async function listAlerts(userId: string): Promise<Alert[]> {
  await ensureAlertsTable();
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        SELECT id, ticker, kind, threshold, note, created_at, triggered_at, disabled
        FROM alerts
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `) as Row[];
      const items = rows.map(rowToAlert);
      const m = memBucket(userId);
      m.clear();
      for (const a of items) m.set(a.id, a);
      return items;
    }
  }
  return [...memBucket(userId).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listActiveAlerts(userId: string): Promise<Alert[]> {
  const all = await listAlerts(userId);
  return all.filter((a) => !a.disabled && !a.triggeredAt);
}

export type CreateAlertInput = {
  ticker: string;
  kind: AlertKind;
  threshold: number;
  note?: string;
};

export async function createAlert(userId: string, input: CreateAlertInput): Promise<Alert> {
  await ensureAlertsTable();
  const id = newId();
  const createdAt = new Date();
  const alert: Alert = {
    id,
    ticker: input.ticker.trim().toUpperCase(),
    kind: input.kind,
    threshold: input.threshold,
    createdAt: createdAt.toISOString(),
    disabled: false,
  };
  const note = input.note?.trim();
  if (note) alert.note = note;

  memBucket(userId).set(id, alert);

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      await sql`
        INSERT INTO alerts (id, user_id, ticker, kind, threshold, note, created_at, disabled)
        VALUES (
          ${alert.id},
          ${userId},
          ${alert.ticker},
          ${alert.kind},
          ${alert.threshold},
          ${alert.note ?? null},
          ${createdAt},
          false
        )
      `;
    }
  }
  return alert;
}

export async function deleteAlert(userId: string, id: string): Promise<boolean> {
  await ensureAlertsTable();
  const removedMem = memBucket(userId).delete(id);
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        DELETE FROM alerts WHERE user_id = ${userId} AND id = ${id}
        RETURNING id
      `) as unknown[];
      return rows.length > 0 || removedMem;
    }
  }
  return removedMem;
}

/**
 * Mark an alert as triggered. Returns the updated alert (with triggeredAt set)
 * or null when the id is not found. Idempotent — a second call on an
 * already-triggered alert leaves triggeredAt unchanged.
 */
export async function markTriggered(
  userId: string,
  id: string,
  triggeredAt: Date = new Date(),
): Promise<Alert | null> {
  await ensureAlertsTable();
  const mem = memBucket(userId).get(id);
  if (!mem) return null;
  if (mem.triggeredAt) return mem;
  const iso = triggeredAt.toISOString();
  const next: Alert = { ...mem, triggeredAt: iso };
  memBucket(userId).set(id, next);
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      await sql`
        UPDATE alerts
        SET triggered_at = ${triggeredAt}
        WHERE user_id = ${userId} AND id = ${id} AND triggered_at IS NULL
      `;
    }
  }
  return next;
}

/**
 * True when the current quote satisfies the alert's condition.
 * - price_above: price >= threshold
 * - price_below: price <= threshold
 * - pct_move:    |changePct| >= threshold  (threshold is a positive number,
 *                e.g. 5 = "alert me on any 5%+ move either direction")
 *
 * Any missing/NaN input returns false — never trigger on bad data.
 */
export function isAlertTriggered(
  alert: Pick<Alert, "kind" | "threshold">,
  quote: { price?: number; changePct?: number } | null | undefined,
): boolean {
  if (!quote) return false;
  const threshold = Number(alert.threshold);
  if (!Number.isFinite(threshold)) return false;
  switch (alert.kind) {
    case "price_above": {
      const p = Number(quote.price);
      return Number.isFinite(p) && p >= threshold;
    }
    case "price_below": {
      const p = Number(quote.price);
      return Number.isFinite(p) && p <= threshold;
    }
    case "pct_move": {
      const c = Number(quote.changePct);
      return Number.isFinite(c) && Math.abs(c) >= Math.abs(threshold);
    }
    default:
      return false;
  }
}

/** Test hook. */
export function _resetAlertsMemory(): void {
  memory.clear();
  tableReady = false;
}
