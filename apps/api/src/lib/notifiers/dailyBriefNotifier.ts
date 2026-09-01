import { deliverPush } from "../push-dispatcher.js";
import { listTokensForUserAndEvent } from "../push-tokens-store.js";
/**
 * Daily-brief push notifier.
 *
 * Fires from two places:
 *   1. Transactional — `generateWatchlistBrief` calls `onDailyBriefGenerated`
 *      after a fresh brief is produced. That handles the "user opened the app
 *      before the scheduler fired" case.
 *   2. Scheduled — `scheduler.ts` calls this on a 7am tick for every user with
 *      the opt-in on.
 *
 * Both entry points funnel through `pushDailyBriefTo(userId, brief)` which
 * dedupes on `daily_brief::YYYYMMDD` so multiple triggers on the same UTC day
 * collapse to one notification.
 */
import type { DailyBrief } from "../watchlist-brief.js";
import { ymd } from "./dedupe.js";

const DEDUPE_SLOT = "daily_brief";

/** Public API — call after a brief is generated for `userId`. */
export async function onDailyBriefGenerated(userId: string, brief: DailyBrief): Promise<void> {
  const key = ymd(new Date(brief.generatedAt));
  const tokens = await listTokensForUserAndEvent(userId, "daily_brief");
  if (tokens.length === 0) return;
  await deliverPush({
    tokens,
    dedupe: [{ slot: DEDUPE_SLOT, key }],
    eventKey: "daily_brief",
    title: "Your morning read",
    body: brief.headline.slice(0, 240),
    data: { kind: "daily_brief" },
    target: { type: "home", section: "daily-brief" },
  });
}
