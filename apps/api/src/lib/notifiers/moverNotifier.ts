/**
 * Watchlist-mover push notifier.
 *
 * Runs from the scheduler on a 5-minute cadence. For each opted-in user,
 * iterates their default watchlist, fetches a fresh quote per ticker, and
 * pushes on any ticker whose intraday `changePct` exceeds ±5%.
 *
 * Dedupe: `watchlist_mover::${YYYYMMDD}::${ticker}` — one push per ticker per
 * day. The Postgres-persisted `last_sent` map means restarts don't refire.
 */
import { getQuote } from "@mapvest/finance";
import { sendPush } from "../push-dispatcher.js";
import { type PushToken, listTokensForEvent } from "../push-tokens-store.js";
import { listWatchEntries } from "../watchlist-store.js";
import { commitSend, shouldSend, ymd } from "./dedupe.js";

const DEDUPE_SLOT = "watchlist_mover";
const MOVE_THRESHOLD_PCT = 5;

/**
 * Direct-fire helper (also usable from transactional paths in tests).
 */
export async function onWatchlistMover(
  userId: string,
  ticker: string,
  changePct: number,
): Promise<void> {
  const tokens = await listTokensForEvent("watchlist_mover");
  const userTokens = tokens.filter((t) => t.userId === userId);
  if (userTokens.length === 0) return;
  await pushMover(userTokens, ticker, changePct);
}

async function pushMover(
  userTokens: PushToken[],
  ticker: string,
  changePct: number,
): Promise<void> {
  const key = `${ymd()}-${ticker.toUpperCase()}`;
  if (!shouldSend(userTokens, DEDUPE_SLOT, key)) return;
  const sign = changePct >= 0 ? "+" : "";
  const direction = changePct >= 0 ? "up" : "down";
  await sendPush({
    tokens: userTokens.map((t) => t.expoToken),
    title: `$${ticker.toUpperCase()} ${sign}${changePct.toFixed(1)}%`,
    body: `$${ticker.toUpperCase()} is ${direction} ${Math.abs(changePct).toFixed(1)}% today — it's in your universe.`,
    data: {
      kind: "watchlist_mover",
      ticker: ticker.toUpperCase(),
      changePct,
    },
  });
  await commitSend(userTokens, DEDUPE_SLOT, key);
}

/**
 * Fan-out scan across every opted-in user. Called from the scheduler.
 */
export async function runWatchlistMoverScan(): Promise<{
  usersScanned: number;
  moversPushed: number;
}> {
  const tokens = await listTokensForEvent("watchlist_mover");
  if (tokens.length === 0) return { usersScanned: 0, moversPushed: 0 };
  const byUser = new Map<string, PushToken[]>();
  for (const t of tokens) {
    const arr = byUser.get(t.userId) ?? [];
    arr.push(t);
    byUser.set(t.userId, arr);
  }

  let moversPushed = 0;
  for (const [userId, userTokens] of byUser) {
    try {
      const entries = await listWatchEntries(userId);
      if (entries.length === 0) continue;
      const uniqueTickers = [...new Set(entries.map((e) => e.ticker))];
      const quotes = await Promise.all(
        uniqueTickers.map(async (t) => ({
          ticker: t,
          q: await getQuote(t).catch(() => null),
        })),
      );
      for (const { ticker, q } of quotes) {
        if (!q) continue;
        const pct = Number(q.changePct);
        if (!Number.isFinite(pct)) continue;
        if (Math.abs(pct) < MOVE_THRESHOLD_PCT) continue;
        // eslint-disable-next-line no-await-in-loop
        await pushMover(userTokens, ticker, pct);
        moversPushed += 1;
      }
    } catch {
      // Per-user error must not sink other users.
    }
  }
  return { usersScanned: byUser.size, moversPushed };
}
