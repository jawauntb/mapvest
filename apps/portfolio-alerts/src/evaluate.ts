import {
  type AlertConfig,
  type Condition,
  type Metric,
  type Rule,
  WATCHLIST_SMA,
} from "./config.js";
import type { Position, Snapshot } from "./snapshot.js";

// ---------- formatting ----------

const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const money = (n: number) => (Math.abs(n) >= 1000 ? usd0.format(n) : usd2.format(n));
export const price = (n: number) => usd2.format(n);
export const pct = (n: number) => `${n.toFixed(1)}%`;
const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
export const plain = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedPlain = (n: number) => `${n >= 0 ? "+" : ""}${plain(n)}`;
// Indexes ($SPX) and futures (/SB) are points or contract units, not dollars.
export const priceFor = (symbol: string) =>
  symbol.startsWith("$") || symbol.startsWith("/") ? plain : price;
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, ""));

// ---------- position diff ----------

export type PositionChange = {
  symbol: string;
  kind: "new" | "closed" | "increased" | "decreased";
  from: number;
  to: number;
};

export type PositionDiff = {
  // snapshot: compared with the quantities saved by the last run.
  // schwab_previous_session: no saved snapshot yet, so Schwab's own previous-session
  // quantities are used. That baseline cannot see a position closed out entirely.
  baseline: "snapshot" | "schwab_previous_session";
  baselineDate?: string;
  changes: PositionChange[];
};

const EPS = 1e-9;

export function diffPositions(
  current: Position[],
  saved: { date: string; quantities: Record<string, number> } | undefined,
): PositionDiff {
  const changes: PositionChange[] = [];
  const classify = (symbol: string, from: number, to: number) => {
    if (Math.abs(to - from) < EPS) return;
    const kind =
      Math.abs(from) < EPS
        ? "new"
        : Math.abs(to) < EPS
          ? "closed"
          : Math.abs(to) > Math.abs(from)
            ? "increased"
            : "decreased";
    changes.push({ symbol, kind, from, to });
  };

  if (saved) {
    const now = new Map(current.map((p) => [p.symbol, p.quantity]));
    const symbols = new Set([...Object.keys(saved.quantities), ...now.keys()]);
    for (const symbol of [...symbols].sort()) {
      classify(symbol, saved.quantities[symbol] ?? 0, now.get(symbol) ?? 0);
    }
    return { baseline: "snapshot", baselineDate: saved.date, changes };
  }

  for (const p of [...current].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    if (p.previousSessionQuantity !== undefined) {
      classify(p.symbol, p.previousSessionQuantity, p.quantity);
    }
  }
  return { baseline: "schwab_previous_session", changes };
}

export function describeChange(c: PositionChange): string {
  switch (c.kind) {
    case "new":
      return `NEW ${c.symbol}: ${qty(c.to)}`;
    case "closed":
      return `CLOSED ${c.symbol}: was ${qty(c.from)}`;
    default:
      return `${c.symbol}: ${qty(c.from)} → ${qty(c.to)} (${c.to - c.from > 0 ? "+" : ""}${qty(c.to - c.from)})`;
  }
}

// ---------- metrics ----------

export type MetricValue = {
  label: string;
  value?: number;
  display: string;
  fmt: (n: number) => string;
  error?: string;
};

type Ctx = { snap: Snapshot; cfg: AlertConfig; diff: PositionDiff };

function closeAt(snap: Snapshot, symbol: string, daysAgo: number) {
  const series = snap.closes[symbol];
  if (!series) {
    return {
      error: `no price history for ${symbol}${snap.historyErrors[symbol] ? ` (${snap.historyErrors[symbol]})` : ""}`,
    };
  }
  const point = series[series.length - 1 - daysAgo];
  if (!point) return { error: `only ${series.length} closes for ${symbol}` };
  return { point };
}

function quantityOf(snap: Snapshot, symbol: string): number {
  return snap.positions.filter((p) => p.symbol === symbol).reduce((sum, p) => sum + p.quantity, 0);
}

function sleeveValue(snap: Snapshot, symbols: string[]): { value?: number; error?: string } {
  let total = 0;
  for (const symbol of symbols) {
    const q = quantityOf(snap, symbol);
    if (Math.abs(q) < EPS) continue;
    const c = closeAt(snap, symbol, 0);
    if (!c.point) return { error: c.error };
    total += q * c.point.close;
  }
  return { value: total };
}

export function accountValue(snap: Snapshot): { value?: number; basis: string } {
  if (snap.account.priorCloseValue !== undefined) {
    return { value: snap.account.priorCloseValue, basis: "prior close" };
  }
  // Fallback is labeled so the alert never passes off a live value as a close.
  return { value: snap.account.currentValue, basis: "live, prior close unavailable" };
}

export function evaluateMetric(m: Metric, ctx: Ctx): MetricValue {
  const { snap, cfg } = ctx;
  const done = (
    label: string,
    value: number | undefined,
    fmt: (n: number) => string,
    error?: string,
  ): MetricValue =>
    value === undefined || Number.isNaN(value)
      ? { label, display: "n/a", fmt, error: error ?? `${label} unavailable` }
      : { label, value, display: fmt(value), fmt };

  switch (m.metric) {
    case "account_value": {
      if (m.basis === "current")
        return done("Account value (live)", snap.account.currentValue, money);
      const a = accountValue(snap);
      return done(`Account value (${a.basis})`, a.value, money);
    }
    case "drawdown": {
      const a = accountValue(snap).value;
      return done(
        `Drawdown from ${money(cfg.budget.startValue)}`,
        a === undefined ? undefined : cfg.budget.startValue - a,
        money,
      );
    }
    case "budget_used_pct": {
      const a = accountValue(snap).value;
      return done(
        `Loss budget used (of ${money(cfg.budget.maxLoss)})`,
        a === undefined ? undefined : ((cfg.budget.startValue - a) / cfg.budget.maxLoss) * 100,
        pct,
      );
    }
    case "close": {
      const c = closeAt(snap, m.symbol, m.daysAgo);
      const when = c.point ? ` (${c.point.date})` : "";
      const label =
        m.daysAgo === 0
          ? `${m.symbol} close${when}`
          : `${m.symbol} close ${m.daysAgo} sessions back${when}`;
      return done(label, c.point?.close, priceFor(m.symbol), c.error);
    }
    case "sma": {
      const label = `${m.symbol} ${m.period}-day SMA`;
      const series = snap.closes[m.symbol];
      if (!series)
        return done(label, undefined, priceFor(m.symbol), closeAt(snap, m.symbol, 0).error);
      if (series.length < m.period) {
        return done(
          label,
          undefined,
          priceFor(m.symbol),
          `only ${series.length} closes for ${m.symbol}, need ${m.period}`,
        );
      }
      const window = series.slice(-m.period);
      return done(label, window.reduce((s, c) => s + c.close, 0) / m.period, priceFor(m.symbol));
    }
    case "pct_change": {
      const label = `${m.symbol} ${m.days}-session change`;
      const latest = closeAt(snap, m.symbol, 0);
      const earlier = closeAt(snap, m.symbol, m.days);
      if (!latest.point || !earlier.point)
        return done(label, undefined, pct, latest.error ?? earlier.error);
      return done(
        label,
        ((latest.point.close - earlier.point.close) / earlier.point.close) * 100,
        pct,
      );
    }
    case "quote": {
      const q = snap.quotes[m.symbol];
      const name = quoteName(m.symbol, q);
      const missing = q ? `${name}: Schwab quote has no ${m.field}` : quoteError(snap, m.symbol);
      if (m.field === "change_pct") {
        const v =
          q?.last !== undefined && q.priorClose
            ? ((q.last - q.priorClose) / q.priorClose) * 100
            : undefined;
        return done(`${name} change vs prior close`, v, pct, missing);
      }
      const v = m.field === "last" ? q?.last : q?.priorClose;
      return done(`${name} ${m.field === "last" ? "last" : "prior close"}`, v, plain, missing);
    }
    case "quote_spread": {
      const a = snap.quotes[m.symbol];
      const b = snap.quotes[m.minus];
      const pick = (q: typeof a) => (m.field === "last" ? q?.last : q?.priorClose);
      const va = pick(a);
      const vb = pick(b);
      const label = `${quoteName(m.symbol, a)} − ${quoteName(m.minus, b)} (${m.field === "last" ? "last" : "prior close"})`;
      const missing = !a
        ? quoteError(snap, m.symbol)
        : !b
          ? quoteError(snap, m.minus)
          : `Schwab quote has no ${m.field}`;
      return done(
        label,
        va === undefined || vb === undefined ? undefined : va - vb,
        signedPlain,
        missing,
      );
    }
    case "position_quantity":
      return done(`${m.symbol} quantity`, quantityOf(snap, m.symbol), qty);
    case "position_value": {
      const s = sleeveValue(snap, [m.symbol]);
      return done(`${m.symbol} position (at prior close)`, s.value, money, s.error);
    }
    case "sleeve_value": {
      const s = sleeveValue(snap, m.symbols);
      return done(`${m.symbols.join("/")} sleeve (at prior close)`, s.value, money, s.error);
    }
    case "sleeve_weight_pct": {
      const label = `${m.symbols.join("/")} sleeve weight`;
      const s = sleeveValue(snap, m.symbols);
      const a = accountValue(snap).value;
      if (s.value === undefined || !a) return done(label, undefined, pct, s.error);
      return done(label, (s.value / a) * 100, pct);
    }
  }
}

function quoteName(requested: string, q: Snapshot["quotes"][string] | undefined): string {
  const detail = q?.note ?? q?.contract;
  return detail ? `${requested} [${detail}]` : requested;
}

const quoteError = (snap: Snapshot, symbol: string) =>
  snap.quoteErrors[symbol] ?? `no quote for ${symbol}`;

/** One line per watchlist entry. Missing data reads n/a with the reason, never a guess. */
export function watchlistLines(cfg: AlertConfig, snap: Snapshot, diff: PositionDiff): string[] {
  const ctx = { snap, cfg, diff };
  return cfg.watchlist.map((item) => {
    if (typeof item !== "string") {
      const v = evaluateMetric(item.value, ctx);
      return `${item.label}: ${v.display}${v.error ? ` (${v.error})` : ""}`;
    }
    if (item.startsWith("/")) {
      const q = snap.quotes[item];
      if (!q) return `${item}: n/a (${quoteError(snap, item)})`;
      const parts: string[] = [];
      if (q.last !== undefined) parts.push(`last ${plain(q.last)}`);
      if (q.priorClose !== undefined) parts.push(`prior close ${plain(q.priorClose)}`);
      if (q.last !== undefined && q.priorClose) {
        parts.push(signedPct(((q.last - q.priorClose) / q.priorClose) * 100));
      }
      return `${quoteName(item, q)}: ${parts.join(" · ")}`;
    }
    const series = snap.closes[item];
    const last = series?.[series.length - 1];
    if (!series || !last) {
      return `${item}: n/a (${snap.historyErrors[item] ?? "no price history"})`;
    }
    const fmt = priceFor(item);
    const change = (n: number) => {
      const prev = series[series.length - 1 - n];
      return prev ? signedPct(((last.close - prev.close) / prev.close) * 100) : "n/a";
    };
    const parts = [`${fmt(last.close)} (${last.date})`, `1d ${change(1)}`, `5d ${change(5)}`];
    if (series.length >= WATCHLIST_SMA) {
      const sma = series.slice(-WATCHLIST_SMA).reduce((t, c) => t + c.close, 0) / WATCHLIST_SMA;
      parts.push(`${last.close >= sma ? "above" : "below"} ${WATCHLIST_SMA}d SMA ${fmt(sma)}`);
    }
    return `${item}: ${parts.join(" · ")}`;
  });
}

// ---------- conditions ----------

export type ConditionResult = {
  tripped: boolean | null; // null = could not evaluate
  lines: string[];
  errors: string[];
};

const compare = (a: number, op: string, b: number) =>
  op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b;

export function evaluateCondition(c: Condition, ctx: Ctx): ConditionResult {
  if ("left" in c) {
    const left = evaluateMetric(c.left, ctx);
    // A literal threshold is formatted like the metric it is compared with.
    const right: MetricValue =
      typeof c.right === "number"
        ? { label: "", value: c.right, display: left.fmt(c.right), fmt: left.fmt }
        : evaluateMetric(c.right, ctx);
    const errors = [left.error, right.error].filter((e): e is string => Boolean(e));
    if (left.value === undefined || right.value === undefined) {
      return { tripped: null, lines: [], errors };
    }
    const tripped = compare(left.value, c.op, right.value);
    const rhs = right.label ? `${right.label} ${right.display}` : right.display;
    const op = tripped ? c.op : negate(c.op);
    return { tripped, lines: [`${left.label} ${left.display} ${op} ${rhs}`], errors };
  }
  if ("positions_changed" in c) {
    const lines = ctx.diff.changes.map(describeChange);
    return { tripped: ctx.diff.changes.length > 0, lines, errors: [] };
  }
  const parts = ("all" in c ? c.all : c.any).map((sub) => evaluateCondition(sub, ctx));
  const errors = parts.flatMap((p) => p.errors);
  const lines = parts.flatMap((p) => p.lines);
  if ("all" in c) {
    if (parts.some((p) => p.tripped === false)) return { tripped: false, lines, errors };
    if (parts.some((p) => p.tripped === null)) return { tripped: null, lines, errors };
    return { tripped: true, lines, errors };
  }
  if (parts.some((p) => p.tripped === true)) return { tripped: true, lines, errors };
  if (parts.some((p) => p.tripped === null)) return { tripped: null, lines, errors };
  return { tripped: false, lines, errors };
}

const negate = (op: string) => (op === "<" ? "≥" : op === "<=" ? ">" : op === ">" ? "≤" : "<");

export type RuleOutcome = {
  rule: Rule;
  result: ConditionResult;
  shown: MetricValue[];
};

export function evaluateRules(cfg: AlertConfig, snap: Snapshot, diff: PositionDiff): RuleOutcome[] {
  const ctx = { snap, cfg, diff };
  return cfg.rules
    .filter((rule) => rule.enabled)
    .map((rule) => ({
      rule,
      result: evaluateCondition(rule.when, ctx),
      shown: rule.show.map((m) => evaluateMetric(m, ctx)),
    }));
}

/** The line every alert carries: where the account is against the loss budget. */
export function budgetLine(cfg: AlertConfig, snap: Snapshot): string {
  const a = accountValue(snap);
  if (a.value === undefined) return "Account value unavailable — drawdown unknown.";
  const dd = cfg.budget.startValue - a.value;
  const used = (dd / cfg.budget.maxLoss) * 100;
  const left = cfg.budget.maxLoss - dd;
  if (dd <= 0) {
    return `Account ${money(a.value)} (${a.basis}) · up ${money(-dd)} from ${money(cfg.budget.startValue)} start · full ${money(cfg.budget.maxLoss)} loss budget intact`;
  }
  return `Account ${money(a.value)} (${a.basis}) · drawdown ${money(dd)} from ${money(cfg.budget.startValue)} = ${pct(used)} of ${money(cfg.budget.maxLoss)} loss budget · ${money(left)} left`;
}

export function budgetShort(cfg: AlertConfig, snap: Snapshot): string {
  const a = accountValue(snap).value;
  if (a === undefined) return "DD n/a";
  const dd = cfg.budget.startValue - a;
  const k = (n: number) => `$${(n / 1000).toFixed(1)}k`;
  return dd <= 0
    ? `Acct ${k(a)}, up ${k(-dd)}`
    : `Acct ${k(a)}, DD ${k(dd)}/${k(cfg.budget.maxLoss)} (${pct((dd / cfg.budget.maxLoss) * 100)})`;
}
