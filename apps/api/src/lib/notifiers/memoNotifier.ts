/**
 * Memo-finished push notifier. Fires transactionally after `/v1/memo`
 * completes writing to storage for an authenticated user.
 *
 * Dedupe: `memo_finished::YYYYMMDD::${ticker}` — one push per ticker per day.
 */
import { sendPush } from "../push-dispatcher.js";
import { listTokensForUserAndEvent } from "../push-tokens-store.js";
import { commitSend, shouldSend, ymd } from "./dedupe.js";

const DEDUPE_SLOT = "memo_finished";

export async function onMemoFinished(
  userId: string,
  ticker: string,
  provider?: string,
): Promise<void> {
  const tokens = await listTokensForUserAndEvent(userId, "memo_finished");
  if (tokens.length === 0) return;
  const key = `${ymd()}-${ticker.toUpperCase()}`;
  if (!shouldSend(tokens, DEDUPE_SLOT, key)) return;

  await sendPush({
    tokens: tokens.map((t) => t.expoToken),
    title: `Memo ready — $${ticker.toUpperCase()}`,
    body: provider
      ? `Your ${provider} memo for $${ticker.toUpperCase()} finished writing.`
      : `Your investment memo for $${ticker.toUpperCase()} is ready to read.`,
    data: { kind: "memo_finished", ticker: ticker.toUpperCase() },
  });
  await commitSend(tokens, DEDUPE_SLOT, key);
}
