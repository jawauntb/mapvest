/**
 * Rivalry weekly-close notifier (Universe Roadmap §3 C6).
 *
 * A rivalry is a solo weekly matchup between one of the user's finds and a
 * comparable (NVDA vs AMD). Once a week this runner closes every open round:
 * it reads five trading days of provider closes for both tickers, scores the
 * round on percentage change, updates the running record, grants XP when a
 * pre-registered pick was right, and sends exactly one push per rivalry per
 * week.
 *
 * Framing (roadmap §4, non-negotiable): this is a collection and comprehension
 * mechanic. There is no opponent user, no position, no prediction market. No
 * copy in this file says buy / sell / should / hold, and nothing here suggests
 * an action — it reports what the two companies did and what the record is.
 *
 * Data: closes come from `getHistoricalCloses` (the provider-routed facade in
 * `@mapvest/finance`). When either side has no usable history the round is
 * SKIPPED — not scored, not recorded, not pushed. A missing week is a missing
 * week; a fabricated one would be a fabricated financial claim (AGENTS.md §2.4).
 *
 * Opt-in: rivalries do NOT get a new `PUSH_EVENT_KEYS` entry. Creating a
 * rivalry IS the opt-in — the user explicitly signed up for a weekly round —
 * so the gate is "this rivalry exists AND the user has at least one registered
 * push token". A product-level mute on a token suppresses delivery without
 * treating the OS permission state as product consent. A user with no token
 * still gets no push (and, because the durable dedupe lives on the token's
 * `prefs`, no scored round either; see the note on `runRivalryWeeklyClose`).
 *
 * Dedupe: slot `rivalry:{id}`, key = `mondayUtc(now)` (`YYYY-MM-DD`) — the
 * Monday that anchors the week being scored. One fire per rivalry per week,
 * durable across restarts via `prefs.last_sent`.
 *
 * XP: a correct pre-registered pick earns `RIVALRY_PICK_XP` under the grant key
 * `rivalry:{id}:{weekStart}` — `awardXp` is idempotent on that key, so a retry
 * can never double-pay.
 */
import { getHistoricalCloses } from "@mapvest/finance";
import { awardXp } from "../progress-store.js";
import { sendPush } from "../push-dispatcher.js";
import {
  type PushToken,
  listTokensForUser,
  pushNotificationsEnabled,
} from "../push-tokens-store.js";
import {
  type RivalryOutcome,
  type RivalryPick,
  type StoredRivalry,
  listAllRivalries,
  mondayUtc,
  nextMondayUtc,
  recordResult,
} from "../rivalries-store.js";
import { commitSend, shouldSend } from "./dedupe.js";

/** XP for a correct pre-registered pick. */
export const RIVALRY_PICK_XP = 30;

/**
 * Below this absolute gap in percentage POINTS the week is a draw. Two tickers
 * that finished 0.1pp apart did not really beat each other, and calling that a
 * win teaches noise.
 */
export const DRAW_THRESHOLD_PP = 0.15;

/** Trading sessions in one round. */
export const SESSIONS_PER_ROUND = 5;

/** Shortest history window the facade offers; 5 sessions are sliced from it. */
const HISTORY_PERIOD = "1mo" as const;

/** Belt-and-braces ceiling on rounds closed in a single run. */
const MAX_RIVALRIES_PER_RUN = 5000;

/**
 * In-memory dedupe TTL — 8 days, so the process-local ring outlives one round
 * and the weekly key can never be consumed twice inside one uptime window.
 */
const DEDUPE_TTL_MS = 8 * 24 * 60 * 60 * 1000;

type HistoryPoint = { ts: number; close: number };

/** Durable dedupe slot for one rivalry. Its stored value is the week key. */
export function rivalryDedupeSlot(rivalryId: string): string {
  return `rivalry:${rivalryId}`;
}

/** Idempotent XP grant key for one rivalry's one round. */
export function rivalryGrantKey(rivalryId: string, weekStart: string): string {
  return `rivalry:${rivalryId}:${weekStart}`;
}

/**
 * Percentage change across the last `sessions` trading days of a close series.
 * Pure. Returns `null` when the series is missing, too short, or its basis is
 * not a positive finite number — never a zero-filled stand-in.
 *
 * With `sessions = 5` and a series ending on Friday, the basis is the previous
 * Friday's close, so the round covers exactly one trading week.
 */
export function weeklyChangePct(
  points: HistoryPoint[] | null | undefined,
  sessions: number = SESSIONS_PER_ROUND,
): number | null {
  if (!Array.isArray(points) || points.length < 2) return null;
  const closes = points.map((p) => Number(p?.close)).filter((c) => Number.isFinite(c));
  if (closes.length < 2) return null;
  const last = closes[closes.length - 1] as number;
  const basisIndex = Math.max(0, closes.length - 1 - sessions);
  const basis = closes[basisIndex] as number;
  if (!(basis > 0)) return null;
  return ((last - basis) / basis) * 100;
}

/**
 * Score one round from the two weekly changes, from the user's `ticker` side.
 * Pure. `diffPp` is the signed gap in percentage points (ticker minus rival);
 * a gap under `DRAW_THRESHOLD_PP` in absolute value is a draw.
 */
export function decideOutcome(
  tickerPct: number,
  rivalPct: number,
): { outcome: RivalryOutcome; diffPp: number } | null {
  if (!Number.isFinite(tickerPct) || !Number.isFinite(rivalPct)) return null;
  const diffPp = tickerPct - rivalPct;
  if (Math.abs(diffPp) < DRAW_THRESHOLD_PP) return { outcome: "draw", diffPp };
  return { outcome: diffPp > 0 ? "win" : "loss", diffPp };
}

/**
 * Whether a pre-registered pick was right. A draw settles nothing, so no pick
 * is correct. Pure.
 */
export function pickWasCorrect(pick: RivalryPick | undefined, outcome: RivalryOutcome): boolean {
  if (!pick) return false;
  if (outcome === "draw") return false;
  return pick === "ticker" ? outcome === "win" : outcome === "loss";
}

/** Push title: the matchup itself. Pure. */
export function rivalryPushTitle(ticker: string, rivalTicker: string): string {
  return `$${ticker} vs $${rivalTicker}`;
}

/**
 * Push body. Collection framing only — reports the week and the record, never
 * an action. Pure so the copy is assertable in tests.
 */
export function rivalryPushBody(params: {
  ticker: string;
  rivalTicker: string;
  outcome: RivalryOutcome;
  diffPp: number;
  wins: number;
  losses: number;
  draws: number;
}): string {
  const { ticker, rivalTicker, outcome, diffPp, wins, losses, draws } = params;
  const gap = Math.abs(diffPp).toFixed(1);
  const record = `record ${wins}-${losses}${draws > 0 ? `-${draws}` : ""}`;
  if (outcome === "win") {
    return `Your ${ticker} beat ${rivalTicker} by ${gap}pp this week — ${record}.`;
  }
  if (outcome === "loss") {
    return `${rivalTicker} beat your ${ticker} by ${gap}pp this week — ${record}.`;
  }
  return `Your ${ticker} and ${rivalTicker} finished level this week — ${record}.`;
}

/** Per-run memo so a ticker shared by many users is fetched once. */
function makeWeeklyChangeLoader(): (symbol: string) => Promise<number | null> {
  const cache = new Map<string, Promise<number | null>>();
  return (symbol: string) => {
    const key = symbol.toUpperCase();
    const hit = cache.get(key);
    if (hit) return hit;
    const p = (async () => {
      const points = (await getHistoricalCloses(key, HISTORY_PERIOD).catch(() => null)) as
        | HistoryPoint[]
        | null;
      return weeklyChangePct(points);
    })();
    cache.set(key, p);
    return p;
  };
}

/**
 * Close every open round. Wired into `scheduler.ts` at Saturday 12:00 UTC —
 * after Friday's close, so the week's five sessions have settled bars, and on
 * the same UTC clock the `mondayUtc(...)` week key uses.
 *
 * Ordering inside one rivalry is deliberate: score → record → award XP →
 * commit dedupe → push. The dedupe key is committed BEFORE the push so a
 * failing push costs at most one notification, never a double-counted week.
 *
 * A user with zero push tokens is skipped entirely: the durable dedupe lives
 * on `prefs.last_sent`, so scoring them would risk re-scoring the same week
 * after a restart. Their rounds resume the first week they register a device.
 * A registered but product-muted device still closes the round and consumes
 * its dedupe key, but receives no delivery; re-enabling later cannot replay a
 * week that was muted when it closed.
 */
export async function runRivalryWeeklyClose(now: Date = new Date()): Promise<{
  rivalriesScanned: number;
  roundsClosed: number;
  pushesSent: number;
  xpGrants: number;
  skippedNoData: number;
}> {
  const weekKey = mondayUtc(now);
  const rows = await listAllRivalries(MAX_RIVALRIES_PER_RUN);
  const out = {
    rivalriesScanned: rows.length,
    roundsClosed: 0,
    pushesSent: 0,
    xpGrants: 0,
    skippedNoData: 0,
  };
  if (rows.length === 0) return out;

  const byUser = new Map<string, StoredRivalry[]>();
  for (const row of rows) {
    const arr = byUser.get(row.userId) ?? [];
    arr.push(row);
    byUser.set(row.userId, arr);
  }

  const weeklyChangeFor = makeWeeklyChangeLoader();

  for (const [userId, rivalries] of byUser) {
    try {
      const tokens: PushToken[] = await listTokensForUser(userId);
      // Creating a rivalry is the opt-in; a registered device is the delivery
      // channel AND the durable dedupe substrate. No token, no round.
      if (tokens.length === 0) continue;
      const deliveryTokens = tokens.filter(pushNotificationsEnabled);

      for (const rivalry of rivalries) {
        const slot = rivalryDedupeSlot(rivalry.id);
        if (!shouldSend(tokens, slot, weekKey)) continue;

        // eslint-disable-next-line no-await-in-loop
        const [tickerPct, rivalPct] = await Promise.all([
          weeklyChangeFor(rivalry.ticker),
          weeklyChangeFor(rivalry.rivalTicker),
        ]);
        if (tickerPct === null || rivalPct === null) {
          out.skippedNoData += 1;
          continue;
        }
        const scored = decideOutcome(tickerPct, rivalPct);
        if (!scored) {
          out.skippedNoData += 1;
          continue;
        }

        // Read the pick BEFORE the close clears it.
        const pick = rivalry.currentPick;
        // The dedupe/grant keys name the round being CLOSED (weekKey); the row
        // itself advances to the round that is now open.
        // eslint-disable-next-line no-await-in-loop
        const updated = await recordResult(rivalry.id, scored.outcome, nextMondayUtc(now));
        if (!updated) continue;
        out.roundsClosed += 1;

        if (pickWasCorrect(pick, scored.outcome)) {
          // eslint-disable-next-line no-await-in-loop
          const granted = await awardXp(
            userId,
            RIVALRY_PICK_XP,
            rivalryGrantKey(rivalry.id, weekKey),
          ).catch(() => false);
          if (granted) out.xpGrants += 1;
        }

        // eslint-disable-next-line no-await-in-loop
        await commitSend(tokens, slot, weekKey, DEDUPE_TTL_MS);
        if (deliveryTokens.length === 0) continue;
        // eslint-disable-next-line no-await-in-loop
        await sendPush({
          tokens: deliveryTokens.map((t) => t.expoToken),
          title: rivalryPushTitle(updated.ticker, updated.rivalTicker),
          body: rivalryPushBody({
            ticker: updated.ticker,
            rivalTicker: updated.rivalTicker,
            outcome: scored.outcome,
            diffPp: scored.diffPp,
            wins: updated.wins,
            losses: updated.losses,
            draws: updated.draws,
          }),
          data: {
            kind: "rivalry_weekly_close",
            rivalryId: updated.id,
            ticker: updated.ticker,
            rivalTicker: updated.rivalTicker,
            outcome: scored.outcome,
            diffPp: scored.diffPp,
            weekStart: weekKey,
          },
        });
        out.pushesSent += 1;
      }
    } catch {
      // A single user's failure must not sink the rest of the fan-out.
    }
  }

  return out;
}
