import type { Quote } from "../quote.js";
import type { HistoryPoint } from "./types.js";

export type HistoryPeriod = "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y";
export type HistoryInterval = "15m" | "1d" | "1w";

export const VALID_HISTORY_PERIODS = new Set<HistoryPeriod>([
  "5d",
  "1mo",
  "3mo",
  "6mo",
  "1y",
  "2y",
]);
export const VALID_INTERVALS = new Set<HistoryInterval>(["15m", "1d", "1w"]);

const INTERVAL_ALIASES: Record<string, HistoryInterval> = {
  "15m": "15m",
  "15min": "15m",
  "15": "15m",
  "1d": "1d",
  "1day": "1d",
  d: "1d",
  day: "1d",
  daily: "1d",
  "1w": "1w",
  "1wk": "1w",
  "1week": "1w",
  w: "1w",
  week: "1w",
  weekly: "1w",
};

export const DEFAULT_PERIOD_FOR_INTERVAL: Record<HistoryInterval, HistoryPeriod> = {
  "15m": "5d",
  "1d": "1y",
  "1w": "2y",
};

const INTRADAY_PERIODS = new Set<HistoryPeriod>(["5d", "1mo"]);
const LOOKBACK_DAYS: Record<HistoryPeriod, number> = {
  "5d": 8,
  "1mo": 45,
  "3mo": 110,
  "6mo": 220,
  "1y": 400,
  "2y": 800,
};

export function normalizeHistoryInterval(value?: string | null): HistoryInterval {
  const raw = String(value ?? "1d").trim().toLowerCase();
  const interval = INTERVAL_ALIASES[raw];
  if (!interval) throw new Error("interval must be 15m, 1d, or 1w");
  return interval;
}

export function clampPeriodForInterval(
  period: HistoryPeriod,
  interval: HistoryInterval,
): HistoryPeriod {
  if (interval === "15m" && !INTRADAY_PERIODS.has(period)) return "5d";
  return period;
}

export function yahooInterval(interval: HistoryInterval): string {
  return interval === "1w" ? "1wk" : interval;
}

export function massiveIntervalSpec(interval: HistoryInterval): {
  multiplier: number;
  timespan: "minute" | "day" | "week";
} {
  if (interval === "15m") return { multiplier: 15, timespan: "minute" };
  if (interval === "1w") return { multiplier: 1, timespan: "week" };
  return { multiplier: 1, timespan: "day" };
}

export function historyDateRange(period: HistoryPeriod): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - LOOKBACK_DAYS[period] * 24 * 60 * 60 * 1_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function applyLiveClose(
  points: HistoryPoint[],
  quote: Pick<Quote, "price" | "ts"> | null | undefined,
  interval: HistoryInterval,
): HistoryPoint[] {
  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) return points;
  const parsed = Date.parse(quote.ts);
  const quoteTs = Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : Math.floor(Date.now() / 1_000);
  if (points.length === 0) return [{ ts: quoteTs, close: quote.price }];
  const last = points[points.length - 1]!;
  if (barKey(last.ts, interval) === barKey(quoteTs, interval)) {
    if (last.close === quote.price) return points;
    return [...points.slice(0, -1), { ts: last.ts, close: quote.price }];
  }
  if (quoteTs <= last.ts) return points;
  return [...points, { ts: quoteTs, close: quote.price }];
}

export function barKey(tsSec: number, interval: HistoryInterval): string {
  const parts = zonedParts(tsSec);
  if (interval === "15m") {
    const minute = Math.floor(parts.minute / 15) * 15;
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${String(minute).padStart(2, "0")}`;
  }
  if (interval === "1w") {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    const weekday = date.getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    date.setUTCDate(date.getUTCDate() + mondayOffset);
    return `w:${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function zonedParts(tsSec: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(tsSec * 1_000));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(formatted.find((part) => part.type === type)?.value ?? "0");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}
