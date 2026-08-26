/**
 * Local-economy brief push notifier.
 *
 * Fires when a fresh local brief is generated for a user whose location has
 * changed materially. The scheduler is responsible for detecting the "moved
 * more than 2km" condition — this notifier is dumb: it just pushes.
 *
 * Dedupe: `local_brief::YYYYMMDD` — a single local brief per day per user.
 */
import type { LocalBrief } from "../local-brief-generator.js";
import { deliverPush } from "../push-dispatcher.js";
import { listTokensForUserAndEvent } from "../push-tokens-store.js";
import { ymd } from "./dedupe.js";

const DEDUPE_SLOT = "local_brief";

export async function onLocalBriefGenerated(
  userId: string,
  brief: LocalBrief,
  location: { lat: number; lng: number },
): Promise<void> {
  const key = ymd(new Date(brief.generatedAt));
  const tokens = await listTokensForUserAndEvent(userId, "local_brief");
  if (tokens.length === 0) return;
  const placeName = brief.place.neighborhood
    ? `${brief.place.neighborhood}${brief.place.city ? `, ${brief.place.city}` : ""}`
    : brief.place.city
      ? `${brief.place.city}${brief.place.state ? `, ${brief.place.state}` : ""}`
      : "your area";
  const first = brief.paragraphs[0]?.slice(0, 220) ?? "";

  await deliverPush({
    tokens,
    dedupe: [{ slot: DEDUPE_SLOT, key }],
    eventKey: "local_brief",
    title: `Local economy — ${placeName}`,
    body: first || `What's investable in ${placeName} right now.`,
    data: {
      kind: "local_brief",
      lat: location.lat,
      lng: location.lng,
    },
  });
}
