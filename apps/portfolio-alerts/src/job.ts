import { type AlertConfig, historyNeeds } from "./config.js";
import { type RuleOutcome, diffPositions, evaluateRules } from "./evaluate.js";
import { composeFailure, composeReauthRequired, composeReport } from "./format.js";
import type { Message, Notifier } from "./notify.js";
import {
  REFRESH_TOKEN_TTL_MS,
  SchwabAuthError,
  SchwabReadOnlyClient,
  refreshAccessToken,
} from "./schwab/client.js";
import { fetchSnapshot, resolveAccountHash } from "./snapshot.js";
import {
  type State,
  type StateStore,
  baselineFor,
  recordAccountValue,
  recordPositions,
  weekAgoValue,
} from "./state.js";
import { isFriday, isWeekday, localParts } from "./time.js";

type Env = Record<string, string | undefined>;

export type JobDeps = {
  env: Env;
  config: AlertConfig;
  now: Date;
  store: StateStore;
  notifier: Notifier;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  // Skip the weekday / run-hour / once-per-day guards (manual runs, --force).
  force?: boolean;
};

export type JobResult =
  | { status: "skipped"; reason: string }
  | { status: "silent" }
  | { status: "alerted"; message: Message }
  | { status: "failed"; reason: string; message?: Message };

const HOUR = 60 * 60 * 1000;

/** Which refresh token to use: env (set by `bun run auth` via Doppler) unless state holds a newer rotation. */
export function pickRefreshToken(env: Env, state: State) {
  const envToken = env.SCHWAB_REFRESH_TOKEN?.trim();
  const envIssued = env.SCHWAB_REFRESH_TOKEN_ISSUED_AT
    ? new Date(env.SCHWAB_REFRESH_TOKEN_ISSUED_AT)
    : undefined;
  const envIssuedOk = envIssued && !Number.isNaN(envIssued.getTime()) ? envIssued : undefined;
  if (
    state.schwab &&
    (!envToken || (envIssuedOk && new Date(state.schwab.issuedAt) > envIssuedOk))
  ) {
    return { refreshToken: state.schwab.refreshToken, issuedAt: new Date(state.schwab.issuedAt) };
  }
  if (!envToken) return undefined;
  return { refreshToken: envToken, issuedAt: envIssuedOk };
}

/** Next scheduled run: the next weekday at roughly the same local time. */
export function nextRunAfter(now: Date, timeZone: string): Date {
  for (let d = 1; d <= 7; d++) {
    const t = new Date(now.getTime() + d * 24 * HOUR);
    if (isWeekday(localParts(t, timeZone))) return t;
  }
  return new Date(now.getTime() + 24 * HOUR);
}

export function reauthNotice(
  issuedAt: Date | undefined,
  now: Date,
  cfg: AlertConfig,
): string | undefined {
  if (!issuedAt) {
    return "SCHWAB_REFRESH_TOKEN_ISSUED_AT is not set, so token expiry can't be predicted. Re-run `bun run auth` to record it.";
  }
  const expiresAt = new Date(issuedAt.getTime() + REFRESH_TOKEN_TTL_MS);
  const nextRun = nextRunAfter(now, cfg.timezone);
  const slackHours = (expiresAt.getTime() - nextRun.getTime()) / HOUR;
  if (slackHours >= cfg.reauthWarnHours) return undefined;
  const when = expiresAt.toLocaleString("en-US", {
    timeZone: cfg.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const urgency =
    slackHours < 0 ? "before the next run" : `${Math.round(slackHours)}h after the next run`;
  return `Schwab refresh token expires ${when} (${urgency}). Run \`bun run auth\` before then or alerts stop.`;
}

export async function runJob(deps: JobDeps): Promise<JobResult> {
  const { env, config: cfg, now, store, notifier } = deps;
  const fetchImpl = deps.fetch ?? fetch;
  const log = deps.log ?? console.log;
  const parts = localParts(now, cfg.timezone);
  const today = parts.date;

  if (!deps.force) {
    if (!isWeekday(parts)) return { status: "skipped", reason: "weekend" };
    // Railway/GitHub cron is UTC; the schedule fires at both DST offsets and one of them lands here.
    if (parts.hour !== cfg.runHour) {
      return { status: "skipped", reason: `local hour ${parts.hour} ≠ runHour ${cfg.runHour}` };
    }
  }

  const state = await store.load();
  if (!deps.force && state.lastCompletedRun?.date === today) {
    return { status: "skipped", reason: `already ran ${today}` };
  }

  const deliver = async (message: Message) => {
    const { sent, failed } = await notifier.send(message);
    for (const f of failed) log(`notify ${f.channel} failed: ${f.error}`);
    return sent.length > 0 || message.channels.length === 0;
  };

  const token = pickRefreshToken(env, state);
  const appKey = env.SCHWAB_APP_KEY;
  const appSecret = env.SCHWAB_APP_SECRET;
  if (!token || !appKey || !appSecret) {
    const reason = "Missing SCHWAB_APP_KEY, SCHWAB_APP_SECRET or SCHWAB_REFRESH_TOKEN.";
    const message = composeReauthRequired(reason, today);
    await deliver(message);
    return { status: "failed", reason, message };
  }

  let report: Message;
  try {
    const access = await refreshAccessToken(
      { appKey, appSecret, refreshToken: token.refreshToken },
      fetchImpl,
    );
    if (access.refresh_token && access.refresh_token !== token.refreshToken) {
      // Expiry still counts from the original browser login.
      state.schwab = {
        refreshToken: access.refresh_token,
        issuedAt: (token.issuedAt ?? now).toISOString(),
      };
    }
    const client = new SchwabReadOnlyClient(access.access_token, fetchImpl);
    const accountHash = await resolveAccountHash(
      client,
      env.SCHWAB_ACCOUNT_HASH?.trim() || undefined,
    );
    const needs = historyNeeds(cfg);
    const snap = await fetchSnapshot({
      client,
      accountHash,
      symbols: needs.symbols,
      now,
      timeZone: cfg.timezone,
    });

    const diff = diffPositions(snap.positions, baselineFor(state, today));
    const outcomes = evaluateRules(cfg, snap, diff);

    // Track how long each rule has been tripped (for on_trip and "day N" labels).
    const alerting: RuleOutcome[] = [];
    for (const o of outcomes) {
      const prev = state.activeRules[o.rule.id];
      if (o.result.tripped === true) {
        const isNew = !prev;
        const days = !prev ? 1 : prev.lastSeen === today ? prev.days : prev.days + 1;
        state.activeRules[o.rule.id] = { since: prev?.since ?? today, lastSeen: today, days };
        if (o.rule.repeat === "while_active" || isNew) alerting.push(o);
      } else if (o.result.tripped === false) {
        delete state.activeRules[o.rule.id];
      }
    }
    const dataProblems = outcomes
      .filter((o) => o.result.tripped === null)
      .map(
        (o) =>
          `${o.rule.title ?? o.rule.id}: ${o.result.errors.join("; ") || "could not evaluate"}`,
      );
    const reauth = reauthNotice(token.issuedAt, now, cfg);
    const friday = isFriday(parts) && cfg.fridaySummary.enabled;
    // An unknown expiry alone doesn't page; it rides along on the next alert or summary.
    const reauthUrgent = reauth !== undefined && token.issuedAt !== undefined;

    const quantities: Record<string, number> = {};
    for (const p of snap.positions) quantities[p.symbol] = (quantities[p.symbol] ?? 0) + p.quantity;
    const weekAgo = weekAgoValue(state, today);
    recordPositions(state, today, quantities);
    if (snap.account.priorCloseValue !== undefined) {
      recordAccountValue(state, today, snap.account.priorCloseValue);
    }

    if (alerting.length === 0 && dataProblems.length === 0 && !reauthUrgent && !friday) {
      log(`${today}: nothing tripped (${outcomes.length} rules). Silent.`);
      state.lastCompletedRun = { date: today, at: now.toISOString() };
      await store.save(state);
      return { status: "silent" };
    }

    report = composeReport({
      cfg,
      snap,
      diff,
      outcomes,
      alerting,
      active: state.activeRules,
      dataProblems,
      reauth,
      friday,
      weekAgoValue: weekAgo,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const message =
      err instanceof SchwabAuthError
        ? composeReauthRequired(detail, today)
        : composeFailure(detail, today);
    await deliver(message);
    return { status: "failed", reason: detail, message };
  }

  const delivered = await deliver(report);
  if (!delivered) {
    // Leave lastCompletedRun unset so a forced re-run can retry today.
    await store.save(state);
    return { status: "failed", reason: "every notification channel failed", message: report };
  }
  state.lastCompletedRun = { date: today, at: now.toISOString() };
  await store.save(state);
  log(`${today}: sent "${report.subject}" via ${report.channels.join("+")}`);
  return { status: "alerted", message: report };
}
