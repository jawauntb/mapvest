/**
 * Price-alerts push notifier.
 *
 * Runs on a scheduled cadence (2×/day per the spec). For each user opted into
 * `price_alerts`, iterates their active alerts, fetches a fresh quote per
 * unique ticker, marks any that flipped as triggered, and pushes a single
 * notification enumerating them.
 *
 * Idempotency: `markTriggered` sets `triggered_at` in the DB; once set, the
 * alert is no longer "active" so we never re-push. The central delivery
 * claim records the aggregate's per-alert keys only after a successful handoff.
 */
import { getQuote } from "@mapvest/finance";
import { isAlertTriggered, listActiveAlerts, markTriggered } from "../alerts-store.js";
import { deliverPush } from "../push-dispatcher.js";
import { type PushToken, listTokensForEvent } from "../push-tokens-store.js";
import { ymd } from "./dedupe.js";

const DEDUPE_SLOT = "price_alerts";

/**
 * Fan out to every user with `price_alerts=true`. Returns coarse counters
 * for observability.
 */
export async function runPriceAlertScan(): Promise<{
  usersScanned: number;
  alertsTriggered: number;
  pushesSent: number;
}> {
  const tokens = await listTokensForEvent("price_alerts");
  if (tokens.length === 0) {
    return { usersScanned: 0, alertsTriggered: 0, pushesSent: 0 };
  }

  // Group opted-in tokens by userId — a user may have multiple devices, but
  // we scan alerts once per user and push to all of their tokens.
  const byUser = new Map<string, PushToken[]>();
  for (const t of tokens) {
    const arr = byUser.get(t.userId) ?? [];
    arr.push(t);
    byUser.set(t.userId, arr);
  }

  let alertsTriggered = 0;
  let pushesSent = 0;
  const today = ymd(new Date());

  for (const [userId, userTokens] of byUser) {
    try {
      const active = await listActiveAlerts(userId);
      if (active.length === 0) continue;
      const uniqueTickers = [...new Set(active.map((a) => a.ticker))];
      const quotes = new Map<string, Awaited<ReturnType<typeof getQuote>>>();
      await Promise.all(
        uniqueTickers.map(async (t) => {
          const q = await getQuote(t).catch(() => null);
          quotes.set(t, q);
        }),
      );

      const triggeredNow: Array<{ ticker: string; kind: string; threshold: number }> = [];
      const dedupe = [] as Array<{ slot: string; key: string }>;
      for (const alert of active) {
        const q = quotes.get(alert.ticker);
        if (!q) continue;
        if (!isAlertTriggered(alert, q)) continue;
        const key = `${DEDUPE_SLOT}-${today}-${alert.id}`;
        const updated = await markTriggered(userId, alert.id);
        if (!updated?.triggeredAt) continue;
        alertsTriggered += 1;
        triggeredNow.push({
          ticker: alert.ticker,
          kind: alert.kind,
          threshold: alert.threshold,
        });
        dedupe.push({ slot: DEDUPE_SLOT, key });
      }
      if (triggeredNow.length === 0) continue;

      const title =
        triggeredNow.length === 1
          ? `Price alert: $${triggeredNow[0]!.ticker}`
          : `Price alerts: ${triggeredNow.length} tickers moved`;
      const body =
        triggeredNow.length === 1
          ? `${describeAlert(triggeredNow[0]!)}`
          : triggeredNow
              .slice(0, 3)
              .map((a) => `$${a.ticker}`)
              .join(", ") + (triggeredNow.length > 3 ? ` +${triggeredNow.length - 3} more` : "");

      const result = await deliverPush({
        tokens: userTokens,
        dedupe,
        eventKey: "price_alerts",
        title,
        body,
        data: {
          kind: "price_alert",
          tickers: triggeredNow.map((t) => t.ticker),
        },
        target: { type: "alerts" },
      });
      pushesSent += result.successes;
    } catch {
      // Never let one user's failure kill the scan for other users.
    }
  }

  return { usersScanned: byUser.size, alertsTriggered, pushesSent };
}

function describeAlert(a: { ticker: string; kind: string; threshold: number }): string {
  switch (a.kind) {
    case "price_above":
      return `$${a.ticker} crossed above $${a.threshold.toFixed(2)}`;
    case "price_below":
      return `$${a.ticker} fell below $${a.threshold.toFixed(2)}`;
    case "pct_move":
      return `$${a.ticker} moved by ${Math.abs(a.threshold).toFixed(1)}% or more`;
    default:
      return `$${a.ticker} triggered`;
  }
}
