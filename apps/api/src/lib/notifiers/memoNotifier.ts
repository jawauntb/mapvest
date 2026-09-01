/**
 * Memo-finished push notifier. Fires transactionally after `/v1/memo`
 * completes writing to storage for an authenticated user.
 *
 * Dedupe: `memo_finished::YYYYMMDD::${ticker}` — one push per ticker per day.
 */
import { deliverPush } from "../push-dispatcher.js";
import { listTokensForUserAndEvent } from "../push-tokens-store.js";
import { ymd } from "./dedupe.js";

const DEDUPE_SLOT = "memo_finished";

export async function onMemoFinished(userId: string, ticker: string): Promise<void> {
  const tokens = await listTokensForUserAndEvent(userId, "memo_finished");
  if (tokens.length === 0) return;
  const key = `${ymd()}-${ticker.toUpperCase()}`;
  await deliverPush({
    tokens,
    dedupe: [{ slot: DEDUPE_SLOT, key }],
    eventKey: "memo_finished",
    title: `Your $${ticker.toUpperCase()} brief is ready`,
    body: `Your investment memo for $${ticker.toUpperCase()} is ready to read.`,
    data: { kind: "memo_finished", ticker: ticker.toUpperCase() },
    target: { type: "company", ticker: ticker.toUpperCase() },
  });
}
