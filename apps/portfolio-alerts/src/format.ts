import type { AlertConfig, Channel } from "./config.js";
import { type PositionDiff, type RuleOutcome, budgetLine, budgetShort, money } from "./evaluate.js";
import type { Message } from "./notify.js";
import type { Snapshot } from "./snapshot.js";

export type ActiveInfo = { since: string; days: number };

export type Report = {
  cfg: AlertConfig;
  snap: Snapshot;
  diff: PositionDiff;
  outcomes: RuleOutcome[];
  alerting: RuleOutcome[];
  active: Record<string, ActiveInfo>;
  dataProblems: string[];
  reauth?: string;
  friday: boolean;
  weekAgoValue?: { date: string; value: number };
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const SMS_LIMIT = 480;
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

const titleOf = (o: RuleOutcome) => o.rule.title ?? o.rule.id;

export function composeReport(r: Report): Message {
  const lines: string[] = [];
  const kind =
    r.alerting.length > 0 ? "PORTFOLIO ALERT" : r.friday ? "WEEKLY SUMMARY" : "PORTFOLIO NOTICE";
  lines.push(`${kind} — ${r.snap.today} · rules evaluated on prior-session closes`);
  lines.push("");
  lines.push(`${r.snap.account.number}: ${budgetLine(r.cfg, r.snap)}`);

  if (r.alerting.length > 0) {
    lines.push("", "TRIPPED");
    r.alerting.forEach((o, i) => {
      const a = r.active[o.rule.id];
      const age = !a || a.days <= 1 ? "new today" : `day ${a.days}, since ${a.since}`;
      lines.push(`${i + 1}. ${titleOf(o)}  [${age}]${o.rule.owner ? `  (${o.rule.owner})` : ""}`);
      for (const l of o.result.lines) lines.push(`   ${l}`);
      for (const m of o.shown) lines.push(`   ${m.label}: ${m.display}`);
      lines.push(`   → Consider: ${o.rule.action}`);
    });
    if (r.alerting.some((o) => "positions_changed" in o.rule.when)) {
      lines.push(
        "",
        r.diff.baseline === "snapshot"
          ? `Position diff is against the ${r.diff.baselineDate} snapshot.`
          : "Position diff uses Schwab's previous-session quantities (no saved snapshot yet; fully closed positions are not visible this run).",
      );
    }
  }

  if (r.dataProblems.length > 0) {
    lines.push("", "COULD NOT CHECK (treat as unknown, not clear)");
    for (const p of r.dataProblems) lines.push(`- ${p}`);
  }

  if (r.reauth) lines.push("", "SCHWAB LOGIN", `- ${r.reauth}`);

  if (r.friday) {
    lines.push("", "WEEKLY SUMMARY");
    if (r.weekAgoValue) {
      const now = r.snap.account.priorCloseValue;
      if (now !== undefined) {
        const d = now - r.weekAgoValue.value;
        lines.push(
          `Week: ${d >= 0 ? "+" : ""}${money(d)} since ${r.weekAgoValue.date} (${money(r.weekAgoValue.value)})`,
        );
      }
    }
    lines.push("Rules:");
    for (const o of r.outcomes) {
      const status =
        o.result.tripped === true ? "TRIPPED" : o.result.tripped === false ? "clear" : "unknown";
      const detail =
        "positions_changed" in o.rule.when
          ? `${r.diff.changes.length} change(s) today`
          : (o.result.lines[0] ?? o.result.errors[0] ?? "");
      lines.push(`- ${titleOf(o)}: ${status}${detail ? ` — ${detail}` : ""}`);
    }
    lines.push("Positions (Schwab live market value at run time):");
    const positions = [...r.snap.positions].sort(
      (a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0),
    );
    for (const p of positions) {
      lines.push(
        `- ${p.symbol}: ${p.quantity}${p.marketValue !== undefined ? ` · ${money(p.marketValue)}` : ""}`,
      );
    }
  }

  lines.push(
    "",
    `Sources: Schwab Trader API accounts + positions, Schwab market data daily price history (fetched ${r.snap.fetchedAt}).`,
    "Read-only job: actions come from your rules config; nothing is traded automatically.",
  );

  const text = lines.join("\n");

  const subjectParts: string[] = [];
  if (r.alerting.length > 0) subjectParts.push(r.alerting.map(titleOf).join(" · "));
  if (r.reauth) subjectParts.push("Schwab re-auth due");
  if (r.dataProblems.length > 0 && r.alerting.length === 0) subjectParts.push("data problem");
  const subject =
    r.alerting.length > 0
      ? `Portfolio alert: ${subjectParts.join(" · ")}`
      : r.friday
        ? `Portfolio weekly summary · ${r.snap.today}${subjectParts.length ? ` · ${subjectParts.join(" · ")}` : ""}`
        : `Portfolio notice: ${subjectParts.join(" · ")}`;

  const smsParts: string[] = [];
  for (const o of r.alerting) {
    const what =
      "positions_changed" in o.rule.when
        ? `positions: ${o.result.lines.join(", ")}`
        : (o.result.lines[0] ?? titleOf(o));
    smsParts.push(`${what} → ${o.rule.action}`);
  }
  if (r.dataProblems.length > 0) smsParts.push(`${r.dataProblems.length} rule(s) unchecked`);
  if (r.reauth) smsParts.push("Schwab re-auth due, see email");
  if (r.friday && r.alerting.length === 0) smsParts.unshift("weekly: nothing tripped");
  const sms = clip(
    `Portfolio ${r.snap.today}: ${smsParts.join("; ")} | ${budgetShort(r.cfg, r.snap)}`,
    SMS_LIMIT,
  );

  const channels = new Set<Channel>();
  for (const o of r.alerting) for (const c of o.rule.channels) channels.add(c);
  if (r.reauth || r.dataProblems.length > 0) {
    channels.add("email");
    channels.add("sms");
  }
  if (r.friday) for (const c of r.cfg.fridaySummary.channels) channels.add(c);

  return {
    subject,
    text,
    html: `<pre style="font:14px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
    sms,
    channels: [...channels],
  };
}

export function composeReauthRequired(detail: string, today: string): Message {
  const text = [
    `SCHWAB RE-AUTH REQUIRED — ${today}`,
    "",
    "The portfolio alert job could not refresh its Schwab token, so no rules were checked today.",
    "Schwab refresh tokens expire 7 days after each browser login.",
    "",
    "Fix (about a minute, on your laptop):",
    "  cd apps/portfolio-alerts",
    "  doppler run --project mapvest --config prd_portfolio_alerts -- bun run auth -- --doppler mapvest/prd_portfolio_alerts",
    "",
    `Detail: ${detail}`,
  ].join("\n");
  return {
    subject: "Schwab re-auth required — portfolio alerts are paused",
    text,
    html: `<pre style="font:14px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
    sms: `Portfolio alerts paused ${today}: Schwab token expired. Run bun run auth (see email).`,
    channels: ["email", "sms"],
  };
}

export function composeFailure(detail: string, today: string): Message {
  const text = `PORTFOLIO ALERT JOB FAILED — ${today}\n\nNo rules were checked today.\n\n${detail}`;
  return {
    subject: "Portfolio alert job failed — rules not checked",
    text,
    html: `<pre style="font:14px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
    sms: clip(`Portfolio alert job failed ${today}, rules not checked: ${detail}`, SMS_LIMIT),
    channels: ["email", "sms"],
  };
}
