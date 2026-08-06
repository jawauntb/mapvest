/**
 * Image-processing push notifier. Fires when `/v1/identify` returns for an
 * authenticated user — supports both foreground (user waiting) and queued/
 * background photo pipelines.
 *
 * Dedupe: `identify_done::${YYYYMMDDHH}::${brand}` — one push per brand per
 * hour, so a burst of similar identifications collapses.
 */
import { sendPush } from "../push-dispatcher.js";
import { listTokensForUserAndEvent } from "../push-tokens-store.js";
import { commitSend, shouldSend, ymdh } from "./dedupe.js";

const DEDUPE_SLOT = "identify_done";

export async function onIdentifyFinished(
  userId: string,
  brand: string | undefined,
  ticker: string | undefined,
): Promise<void> {
  const tokens = await listTokensForUserAndEvent(userId, "identify_done");
  if (tokens.length === 0) return;
  const key = `${ymdh()}-${(brand ?? ticker ?? "unknown").toLowerCase()}`;
  if (!shouldSend(tokens, DEDUPE_SLOT, key)) return;

  const label = brand ?? ticker ?? "your photo";
  const body = ticker
    ? `${label} maps to $${ticker.toUpperCase()}. Tap to open.`
    : `${label} identified — no public ticker match.`;

  await sendPush({
    tokens: tokens.map((t) => t.expoToken),
    title: "Photo identified",
    body,
    data: {
      kind: "identify_done",
      brand: brand ?? "",
      ticker: ticker ?? "",
    },
  });
  await commitSend(tokens, DEDUPE_SLOT, key);
}
