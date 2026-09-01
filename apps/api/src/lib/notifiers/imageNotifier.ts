/**
 * Image-processing push notifier. Fires when `/v1/identify` returns for an
 * authenticated user — supports both foreground (user waiting) and queued/
 * background photo pipelines.
 *
 * Dedupe: `identify_done::${YYYYMMDDHH}::${brand}` — one push per brand per
 * hour, so a burst of similar identifications collapses.
 */
import { deliverPush } from "../push-dispatcher.js";
import { listTokensForUserAndEvent } from "../push-tokens-store.js";
import { ymdh } from "./dedupe.js";

const DEDUPE_SLOT = "identify_done";

export async function onIdentifyFinished(
  userId: string,
  brand: string | undefined,
  ticker: string | undefined,
): Promise<void> {
  const tokens = await listTokensForUserAndEvent(userId, "identify_done");
  if (tokens.length === 0) return;
  const key = `${ymdh()}-${(brand ?? ticker ?? "unknown").toLowerCase()}`;
  const body = ticker
    ? `$${ticker.toUpperCase()} — ${brand ?? ticker.toUpperCase()}`
    : `No public match for ${brand ?? "your photo"} — see its cousins.`;

  await deliverPush({
    tokens,
    dedupe: [{ slot: DEDUPE_SLOT, key }],
    eventKey: "identify_done",
    title: "Found it",
    body,
    data: {
      kind: "identify_done",
      brand: brand ?? "",
      ticker: ticker ?? "",
    },
    target: ticker ? { type: "company", ticker: ticker.toUpperCase() } : { type: "camera" },
  });
}
