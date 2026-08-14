/**
 * Agent-response push notifier. Fires when a research chat stream finishes
 * assembling a ResearchArticle for the user.
 *
 * Dedupe: `agent_response::${threadId}::${YYYYMMDDHH}` — deduped on
 * (thread, hour) so a chatty burst yields at most one push per hour per
 * thread. Backgrounded/foregrounded UX handled by the client (setNotification
 * handler in _layout.tsx).
 */
import { sendPush } from "../push-dispatcher.js";
import { listTokensForUserAndEvent } from "../push-tokens-store.js";
import { commitSend, shouldSend, ymdh } from "./dedupe.js";

const DEDUPE_SLOT = "agent_response";

export async function onAgentResponseReady(
  userId: string,
  threadId: string | undefined,
  articleTitle: string,
): Promise<void> {
  const tokens = await listTokensForUserAndEvent(userId, "agent_response");
  if (tokens.length === 0) return;
  const key = `${threadId ?? "adhoc"}-${ymdh()}`;
  if (!shouldSend(tokens, DEDUPE_SLOT, key)) return;

  await sendPush({
    tokens: tokens.map((t) => t.expoToken),
    title: "Your research is ready",
    body: (articleTitle || "Your research thread has a new response.").slice(0, 240),
    data: {
      kind: "agent_response",
      threadId: threadId ?? "",
    },
  });
  await commitSend(tokens, DEDUPE_SLOT, key);
}
