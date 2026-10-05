import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type AlertConfig, parseConfig } from "../src/config.js";
import type { Message, Notifier } from "../src/notify.js";

export const exampleConfig = (): AlertConfig =>
  parseConfig(JSON.parse(readFileSync(join(import.meta.dir, "..", "rules.example.json"), "utf8")));

/** A typical sleeve setup with fixture numbers. */
export const semisConfig = (overrides: Partial<AlertConfig> = {}): AlertConfig =>
  parseConfig({
    version: 1,
    budget: { startValue: 80000, maxLoss: 30000 },
    rules: [
      {
        id: "account-floor",
        title: "Account below $60k",
        when: { left: { metric: "account_value" }, op: "<", right: 60000 },
        action: "trim the sleeve by half into T-bills",
        show: [{ metric: "sleeve_value", symbols: ["NVDA", "SOXX"] }],
      },
      {
        id: "nvda-180",
        title: "NVDA close below $180",
        when: { left: { metric: "close", symbol: "NVDA" }, op: "<", right: 180 },
        action: "add a small index hedge",
      },
      {
        id: "soxx-50dma",
        title: "SOXX below its 50-day SMA",
        when: {
          left: { metric: "close", symbol: "SOXX" },
          op: "<",
          right: { metric: "sma", symbol: "SOXX", period: 50 },
        },
        action: "add a small index hedge",
      },
      {
        id: "position-diff",
        title: "Positions changed",
        when: { positions_changed: true },
        action: "summary diff",
      },
    ],
    ...overrides,
  });

/** Weekday dates strictly before `today`, oldest first. */
export function tradingDaysBefore(today: string, n: number): string[] {
  const out: string[] = [];
  let t = Date.parse(`${today}T12:00:00Z`);
  while (out.length < n) {
    t -= 86_400_000;
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10));
  }
  return out;
}

type FakePosition = { symbol: string; qty: number; prevQty?: number; marketValue?: number };

export type FakeSchwab = {
  today: string;
  closes: Record<string, number[]>; // oldest first, ending on the session before `today`
  positions: FakePosition[];
  priorCloseValue: number;
  currentValue?: number;
  tokenStatus?: number;
  rotateRefreshToken?: string;
  historyStatus?: Record<string, number>;
};

export type Call = { method: string; url: string };

export function fakeFetch(s: FakeSchwab) {
  const calls: Call[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, url: url.toString() });

    if (url.pathname === "/v1/oauth/token") {
      if (s.tokenStatus && s.tokenStatus !== 200) {
        return json({ error: "refresh_token_authentication_error" }, s.tokenStatus);
      }
      return json({
        access_token: "access-123",
        expires_in: 1800,
        refresh_token: s.rotateRefreshToken ?? "refresh-abc",
      });
    }
    if (url.pathname === "/trader/v1/accounts/accountNumbers") {
      return json([{ accountNumber: "12345678", hashValue: "HASH1" }]);
    }
    if (url.pathname === "/trader/v1/accounts/HASH1") {
      return json({
        securitiesAccount: {
          accountNumber: "12345678",
          type: "MARGIN",
          positions: s.positions.map((p) => ({
            longQuantity: p.qty,
            shortQuantity: 0,
            previousSessionLongQuantity: p.prevQty ?? p.qty,
            marketValue: p.marketValue ?? p.qty * 100,
            instrument: { symbol: p.symbol, assetType: "EQUITY" },
          })),
          initialBalances: { liquidationValue: s.priorCloseValue },
          currentBalances: { liquidationValue: s.currentValue ?? s.priorCloseValue },
        },
      });
    }
    if (url.pathname === "/marketdata/v1/pricehistory") {
      const symbol = url.searchParams.get("symbol") ?? "";
      const status = s.historyStatus?.[symbol];
      if (status) return json({ error: "nope" }, status);
      const closes = s.closes[symbol] ?? [];
      const dates = tradingDaysBefore(s.today, closes.length);
      const candles = closes.map((close, i) => ({
        open: close,
        high: close,
        low: close,
        close,
        volume: 1,
        // Schwab stamps daily candles at midnight US/Central.
        datetime: Date.parse(`${dates[i]}T05:00:00Z`),
      }));
      // An in-progress candle for today must be ignored.
      candles.push({
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
        datetime: Date.parse(`${s.today}T05:00:00Z`),
      });
      return json({ symbol, empty: false, candles });
    }
    if (url.hostname === "api.resend.com" || url.hostname === "api.twilio.com") {
      return json({ id: "ok" });
    }
    return json({ error: `unexpected ${method} ${url}` }, 404);
  }) as typeof fetch;

  return { fetch: impl, calls };
}

export function recordingNotifier() {
  const sent: Message[] = [];
  const notifier: Notifier = {
    async send(message) {
      sent.push(message);
      return { sent: message.channels, failed: [] };
    },
  };
  return { notifier, sent };
}

export const env = {
  SCHWAB_APP_KEY: "key",
  SCHWAB_APP_SECRET: "secret",
  SCHWAB_REFRESH_TOKEN: "refresh-abc",
  SCHWAB_REFRESH_TOKEN_ISSUED_AT: "2026-10-05T13:00:00Z",
};

export const flat = (n: number, v: number) => Array.from({ length: n }, () => v);
