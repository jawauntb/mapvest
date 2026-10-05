import { describe, expect, test } from "bun:test";
import { codeFromRedirect } from "../src/auth.js";
import { historyNeeds, parseConfig } from "../src/config.js";
import { diffPositions } from "../src/evaluate.js";
import { reauthNotice, runJob } from "../src/job.js";
import { liveNotifier } from "../src/notify.js";
import { MemoryStateStore, emptyState } from "../src/state.js";
import {
  type FakeSchwab,
  env,
  exampleConfig,
  fakeFetch,
  flat,
  recordingNotifier,
  semisConfig,
} from "./helpers.js";

// 2026-10-05 is a Monday; 16:05 UTC is 12:05 EDT.
const MON_NOON = new Date("2026-10-05T16:05:00Z");
const TUE_NOON = new Date("2026-10-06T16:05:00Z");
const FRI_NOON = new Date("2026-10-09T16:05:00Z");

const calm = (today = "2026-10-05"): FakeSchwab => ({
  today,
  closes: { NVDA: flat(60, 230), SOXX: flat(60, 250) },
  positions: [
    { symbol: "NVDA", qty: 100 },
    { symbol: "SOXX", qty: 40 },
  ],
  priorCloseValue: 72000,
});

async function run(
  s: FakeSchwab,
  opts: {
    now?: Date;
    store?: MemoryStateStore;
    cfg?: ReturnType<typeof semisConfig>;
    envOverride?: Record<string, string | undefined>;
    force?: boolean;
  } = {},
) {
  const { fetch, calls } = fakeFetch(s);
  const { notifier, sent } = recordingNotifier();
  const store = opts.store ?? new MemoryStateStore();
  const result = await runJob({
    env: { ...env, ...opts.envOverride },
    config: opts.cfg ?? semisConfig(),
    now: opts.now ?? MON_NOON,
    store,
    notifier,
    fetch,
    log: () => {},
    force: opts.force,
  });
  return { result, sent, calls, store };
}

describe("config", () => {
  test("rules.example.json parses and collects history needs", () => {
    const cfg = exampleConfig();
    expect(cfg.rules.length).toBeGreaterThan(3);
    // disabled composite rule's symbols are not fetched
    expect(historyNeeds(cfg)).toEqual({ symbols: ["AAPL", "MSFT", "QQQ"], lookback: 50 });
  });

  test("duplicate ids and unknown metrics are rejected", () => {
    const base = semisConfig();
    expect(() => parseConfig({ ...base, rules: [base.rules[0], base.rules[0]] })).toThrow(
      /duplicate rule id/,
    );
    expect(() =>
      parseConfig({
        ...base,
        rules: [{ id: "x", action: "y", when: { left: { metric: "vibes" }, op: "<", right: 1 } }],
      }),
    ).toThrow(/Invalid portfolio alert rules/);
  });
});

describe("position diff", () => {
  test("against a saved snapshot: new, closed, increased, decreased", () => {
    const diff = diffPositions(
      [
        { symbol: "NVDA", quantity: 50 },
        { symbol: "SGOV", quantity: 200 },
        { symbol: "SOXX", quantity: 60 },
      ],
      { date: "2026-10-02", quantities: { NVDA: 100, SOXX: 40, IOT: 10 } },
    );
    expect(diff.changes).toEqual([
      { symbol: "IOT", kind: "closed", from: 10, to: 0 },
      { symbol: "NVDA", kind: "decreased", from: 100, to: 50 },
      { symbol: "SGOV", kind: "new", from: 0, to: 200 },
      { symbol: "SOXX", kind: "increased", from: 40, to: 60 },
    ]);
  });

  test("without a snapshot falls back to Schwab previous-session quantities", () => {
    const diff = diffPositions(
      [
        { symbol: "NVDA", quantity: 100, previousSessionQuantity: 100 },
        { symbol: "SH", quantity: 30, previousSessionQuantity: 0 },
      ],
      undefined,
    );
    expect(diff.baseline).toBe("schwab_previous_session");
    expect(diff.changes).toEqual([{ symbol: "SH", kind: "new", from: 0, to: 30 }]);
  });
});

describe("schedule guards", () => {
  test("weekend and off-hour runs are skipped", async () => {
    expect((await run(calm(), { now: new Date("2026-10-04T16:05:00Z") })).result).toEqual({
      status: "skipped",
      reason: "weekend",
    });
    // 17:05 UTC is 13:05 EDT — the second (EST) cron slot, which must no-op in summer.
    expect((await run(calm(), { now: new Date("2026-10-05T17:05:00Z") })).result.status).toBe(
      "skipped",
    );
    // In winter (EST) the 17:00 UTC slot is the noon run.
    const winter = await run(
      { ...calm("2026-12-07") },
      {
        now: new Date("2026-12-07T17:05:00Z"),
        envOverride: { SCHWAB_REFRESH_TOKEN_ISSUED_AT: "2026-12-07T13:00:00Z" },
      },
    );
    expect(winter.result.status).toBe("silent");
  });

  test("runs at most once per day", async () => {
    const store = new MemoryStateStore();
    expect((await run(calm(), { store })).result.status).toBe("silent");
    expect((await run(calm(), { store })).result).toEqual({
      status: "skipped",
      reason: "already ran 2026-10-05",
    });
  });
});

describe("runJob", () => {
  test("silent when nothing trips, and saves a position snapshot", async () => {
    const { result, sent, store } = await run(calm());
    expect(result.status).toBe("silent");
    expect(sent).toHaveLength(0);
    expect(store.state.positions.at(-1)).toEqual({
      date: "2026-10-05",
      quantities: { NVDA: 100, SOXX: 40 },
    });
  });

  test("only ever GETs Schwab account/market-data paths (read-only)", async () => {
    const { calls } = await run(calm());
    for (const c of calls) {
      const u = new URL(c.url);
      if (u.pathname === "/v1/oauth/token") expect(c.method).toBe("POST");
      else expect(c.method).toBe("GET");
      expect(u.pathname).not.toMatch(/orders/);
    }
    expect(calls.map((c) => new URL(c.url).pathname)).toContain("/trader/v1/accounts/HASH1");
  });

  test("NVDA below 180 alerts with the drawdown line on email and SMS", async () => {
    const s = calm();
    s.closes.NVDA = [...flat(59, 230), 175.5];
    const { result, sent } = await run(s);
    expect(result.status).toBe("alerted");
    const msg = sent[0]!;
    expect(msg.subject).toBe("Portfolio alert: NVDA close below $180");
    expect(msg.text).toContain("NVDA close (2026-10-02) $175.50 < $180.00");
    expect(msg.text).toContain("→ Consider: add a small index hedge");
    expect(msg.text).toContain(
      "drawdown $8,000 from $80,000 = 26.7% of $30,000 loss budget · $22,000 left",
    );
    expect(msg.sms).toContain("add a small index hedge");
    expect(msg.sms).toContain("DD $8.0k/$30.0k (26.7%)");
    expect(msg.channels.sort()).toEqual(["email", "sms"]);
  });

  test("account floor shows sleeve value; SOXX under its 50-day SMA trips", async () => {
    const s = calm();
    s.priorCloseValue = 59000;
    s.closes.SOXX = [...flat(59, 250), 240]; // SMA50 = 249.8
    const { sent } = await run(s);
    const msg = sent[0]!;
    expect(msg.subject).toBe("Portfolio alert: Account below $60k · SOXX below its 50-day SMA");
    expect(msg.text).toContain("Account value (prior close) $59,000 < $60,000");
    expect(msg.text).toContain("NVDA/SOXX sleeve (at prior close): $32,600");
    expect(msg.text).toContain("SOXX close (2026-10-02) $240.00 < SOXX 50-day SMA $249.80");
  });

  test("position changes since the last run are summarized", async () => {
    const store = new MemoryStateStore();
    await run(calm(), { store });
    const s = calm("2026-10-06");
    s.positions = [
      { symbol: "NVDA", qty: 50 },
      { symbol: "SOXX", qty: 40 },
      { symbol: "SGOV", qty: 300 },
    ];
    const { sent } = await run(s, { store, now: TUE_NOON });
    expect(sent[0]!.subject).toBe("Portfolio alert: Positions changed");
    expect(sent[0]!.text).toContain("NVDA: 100 → 50 (-50)");
    expect(sent[0]!.text).toContain("NEW SGOV: 300");
    expect(sent[0]!.text).toContain("against the 2026-10-05 snapshot");
  });

  test("while_active repeats with a day counter; on_trip alerts once", async () => {
    const s = calm();
    s.closes.NVDA = [...flat(59, 230), 170];
    const store = new MemoryStateStore();
    await run(s, { store });
    const tue = { ...s, today: "2026-10-06" };
    const day2 = await run(tue, { store, now: TUE_NOON });
    expect(day2.sent[0]!.text).toContain("[day 2, since 2026-10-05]");

    const cfg = semisConfig();
    for (const r of cfg.rules) r.repeat = "on_trip";
    const store2 = new MemoryStateStore();
    expect((await run(s, { store: store2, cfg })).result.status).toBe("alerted");
    expect((await run(tue, { store: store2, cfg, now: TUE_NOON })).result.status).toBe("silent");
  });

  test("Friday always sends a summary", async () => {
    const store = new MemoryStateStore({
      ...emptyState(),
      accountValues: [{ date: "2026-10-02", value: 75000 }],
    });
    const { result, sent } = await run(calm("2026-10-09"), {
      now: FRI_NOON,
      store,
      envOverride: { SCHWAB_REFRESH_TOKEN_ISSUED_AT: "2026-10-09T13:00:00Z" },
    });
    expect(result.status).toBe("alerted");
    expect(sent[0]!.subject).toBe("Portfolio weekly summary · 2026-10-09");
    expect(sent[0]!.text).toContain("Week: -$3,000 since 2026-10-02 ($75,000)");
    expect(sent[0]!.text).toContain(
      "- NVDA close below $180: clear — NVDA close (2026-10-08) $230.00 ≥ $180.00",
    );
    expect(sent[0]!.sms).toContain("weekly: nothing tripped");
  });

  test("missing history is reported as unchecked, never as clear", async () => {
    const s = calm();
    s.closes.SOXX = flat(20, 250);
    const { sent } = await run(s);
    expect(sent[0]!.subject).toBe("Portfolio notice: data problem");
    expect(sent[0]!.text).toContain("only 20 closes for SOXX, need 50");
  });

  test("expired refresh token sends a re-auth alert and fails the run", async () => {
    const { result, sent } = await run({ ...calm(), tokenStatus: 400 });
    expect(result.status).toBe("failed");
    expect(sent[0]!.subject).toBe("Schwab re-auth required — portfolio alerts are paused");
    expect(sent[0]!.channels).toEqual(["email", "sms"]);
  });

  test("warns ahead of refresh-token expiry, even across a weekend", async () => {
    const cfg = semisConfig();
    // Logged in Monday 9am ET: dies next Monday 9am, before that day's noon run.
    const issued = new Date("2026-10-05T13:00:00Z");
    expect(reauthNotice(issued, new Date("2026-10-08T16:05:00Z"), cfg)).toBeUndefined(); // Thu
    expect(reauthNotice(issued, FRI_NOON, cfg)).toContain("before the next run");

    const { result, sent } = await run(calm(), {
      envOverride: { SCHWAB_REFRESH_TOKEN_ISSUED_AT: "2026-09-29T15:00:00Z" },
    });
    expect(result.status).toBe("alerted");
    expect(sent[0]!.subject).toBe("Portfolio notice: Schwab re-auth due");
  });

  test("a rotated refresh token is kept in state with the original login time", async () => {
    const { store } = await run({ ...calm(), rotateRefreshToken: "refresh-new" });
    expect(store.state.schwab).toEqual({
      refreshToken: "refresh-new",
      issuedAt: "2026-10-05T13:00:00.000Z",
    });
  });
});

test("auth: code is pulled out of the pasted redirect URL", () => {
  expect(codeFromRedirect("https://127.0.0.1/?code=C0.abc%40&session=xyz")).toBe("C0.abc@");
  expect(() => codeFromRedirect("https://127.0.0.1/?session=xyz")).toThrow(/No \?code=/);
});

test("live notifier: Resend email + Twilio SMS request shapes", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const notifier = liveNotifier(
    {
      RESEND_API_KEY: "re_x",
      ALERT_EMAIL_FROM: "alerts@example.com",
      ALERT_EMAIL_TO: "me@example.com",
      TWILIO_ACCOUNT_SID: "AC1",
      TWILIO_AUTH_TOKEN: "tok",
      TWILIO_FROM_NUMBER: "+15550000000",
      ALERT_SMS_TO: "+15551111111",
    },
    fetchImpl,
  );
  const out = await notifier.send({
    subject: "s",
    text: "t",
    html: "<pre>t</pre>",
    sms: "short",
    channels: ["email", "sms"],
  });
  expect(out).toEqual({ sent: ["email", "sms"], failed: [] });
  expect(requests[0]!.url).toBe("https://api.resend.com/emails");
  expect(JSON.parse(String(requests[0]!.init?.body))).toMatchObject({
    from: "alerts@example.com",
    to: ["me@example.com"],
    subject: "s",
  });
  expect(requests[1]!.url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
  expect(String(requests[1]!.init?.body)).toBe("To=%2B15551111111&From=%2B15550000000&Body=short");

  const unconfigured = await liveNotifier({}, fetchImpl).send({
    subject: "s",
    text: "t",
    html: "",
    sms: "x",
    channels: ["sms"],
  });
  expect(unconfigured.sent).toEqual([]);
  expect(unconfigured.failed[0]!.error).toMatch(/sms not configured/);
});
