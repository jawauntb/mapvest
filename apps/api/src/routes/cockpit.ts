import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { UNDERLYING_URL, isTicker, upstreamFetch } from "../lib/underlying.js";

/**
 * Saved-tab batch surfaces from Underlying Analyzer.
 * POST /v1/cockpit  { tickers: string[] }  (cap 10)
 * POST /v1/alerts   { tickers: string[], maxAlerts?: number }
 */

const MAX_TICKERS = 10;

function normalizeTickers(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const sym = t.trim().toUpperCase();
    if (isTicker(sym) && !out.includes(sym)) out.push(sym);
    if (out.length >= MAX_TICKERS) break;
  }
  return out.length ? out : null;
}

type UpstreamRow = Record<string, unknown>;

function asRows(j: unknown): UpstreamRow[] {
  if (Array.isArray(j)) return j as UpstreamRow[];
  if (j && typeof j === "object") {
    const o = j as Record<string, unknown>;
    for (const key of ["rows", "cockpit", "results", "items", "data"]) {
      if (Array.isArray(o[key])) return o[key] as UpstreamRow[];
    }
  }
  return [];
}

function asAlerts(j: unknown): UpstreamRow[] {
  if (Array.isArray(j)) return j as UpstreamRow[];
  if (j && typeof j === "object") {
    const o = j as Record<string, unknown>;
    for (const key of ["alerts", "items", "results", "data"]) {
      if (Array.isArray(o[key])) return o[key] as UpstreamRow[];
    }
  }
  return [];
}

function cell(v: unknown): string | number | undefined {
  if (v == null) return undefined;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of [
      "recommendation",
      "state",
      "location",
      "signal",
      "score",
      "setup",
    ]) {
      const x = o[k];
      if (typeof x === "string" || typeof x === "number") return x;
    }
  }
  return undefined;
}

function mapCockpitRow(r: UpstreamRow, i: number) {
  const ticker = String(r.ticker ?? r.symbol ?? "").toUpperCase();
  return {
    rank: typeof r.rank === "number" ? r.rank : i + 1,
    ticker,
    score: typeof r.score === "number" ? r.score : typeof r.total === "number" ? r.total : undefined,
    lane: typeof r.lane === "string" ? r.lane : typeof r.regime === "string" ? r.regime : undefined,
    ridge: cell(r.ridge ?? r.ridge_growth ?? r.ridgeScore),
    flow: cell(r.flow ?? r.flow_compass ?? r.flowScore),
    auction: cell(r.auction ?? r.auctionScore ?? r.poc),
  };
}

function mapAlert(r: UpstreamRow) {
  const summary =
    (typeof r.summary === "string" && r.summary) ||
    (typeof r.message === "string" && r.message) ||
    (typeof r.text === "string" && r.text) ||
    (typeof r.detail === "string" && r.detail) ||
    undefined;
  return {
    ticker: typeof r.ticker === "string" ? r.ticker.toUpperCase() : undefined,
    title: typeof r.title === "string" ? r.title : typeof r.type === "string" ? r.type : undefined,
    severity: r.severity ?? r.level ?? r.priority,
    summary,
    message: typeof r.message === "string" ? r.message : summary,
    ...r,
  };
}

const cockpit = new Hono();

cockpit.post("/", async (c) => {
  return safeExecuteWithSpan("http.cockpit", async (span) => {
    const body = (await c.req.json().catch(() => ({}))) as { tickers?: unknown };
    const tickers = normalizeTickers(body.tickers);
    if (!tickers) {
      return c.json({ error: "tickers required (1–10 symbols)" }, 400);
    }
    span.setAttributes({ ticker_count: tickers.length, upstream: UNDERLYING_URL });

    const started = performance.now();
    const res = await upstreamFetch("/api/watchlists/cockpit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers }),
      timeoutMs: 60_000,
    });
    span.setAttributes({
      upstream_status: res.status,
      upstream_latency_ms: Math.round(performance.now() - started),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return c.json(
        { error: `underlying cockpit ${res.status}`, detail: text.slice(0, 300) },
        502,
      );
    }

    const j = await res.json();
    const rows = asRows(j).map(mapCockpitRow);
    return c.json({
      rows,
      tickers,
      meta: j && typeof j === "object" ? (j as Record<string, unknown>).meta : undefined,
      sourceUrl: `${UNDERLYING_URL}/`,
    });
  });
});

export default cockpit;

export const alerts = new Hono();

alerts.post("/", async (c) => {
  return safeExecuteWithSpan("http.alerts", async (span) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      tickers?: unknown;
      maxAlerts?: unknown;
      max_alerts?: unknown;
    };
    const tickers = normalizeTickers(body.tickers);
    if (!tickers) {
      return c.json({ error: "tickers required (1–10 symbols)" }, 400);
    }
    const maxAlerts =
      typeof body.maxAlerts === "number"
        ? body.maxAlerts
        : typeof body.max_alerts === "number"
          ? body.max_alerts
          : 20;
    span.setAttributes({ ticker_count: tickers.length, max_alerts: maxAlerts });

    const started = performance.now();
    const res = await upstreamFetch("/api/watchlists/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers, max_alerts: maxAlerts }),
      timeoutMs: 60_000,
    });
    span.setAttributes({
      upstream_status: res.status,
      upstream_latency_ms: Math.round(performance.now() - started),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return c.json(
        { error: `underlying alerts ${res.status}`, detail: text.slice(0, 300) },
        502,
      );
    }

    const j = await res.json();
    return c.json({
      alerts: asAlerts(j).map(mapAlert),
      tickers,
      meta: j && typeof j === "object" ? (j as Record<string, unknown>).meta : undefined,
      sourceUrl: `${UNDERLYING_URL}/`,
    });
  });
});
