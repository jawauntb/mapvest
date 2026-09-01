/**
 * Local-economy brief push notifier.
 *
 * Fires when a fresh local brief is generated for one device whose location
 * changed materially. The scheduler owns the "moved more than 2km" decision
 * and passes the exact delivery token; local-brief pushes never fan out across
 * an account because a sibling phone did not supply this location.
 *
 * Dedupe: `local_brief:{tokenId}::YYYYMMDD` — a single local brief per day
 * per device.
 */
import type { LocalBrief } from "../local-brief-generator.js";
import { deliverPush } from "../push-dispatcher.js";
import type { PushToken } from "../push-tokens-store.js";
import { ymd } from "./dedupe.js";

function localBriefDedupeSlot(tokenId: string): string {
  return `local_brief:${tokenId}`;
}

export async function onLocalBriefGenerated(
  token: PushToken,
  brief: LocalBrief,
  location: { lat: number; lng: number },
): Promise<void> {
  const key = ymd(new Date(brief.generatedAt));
  const placeName = brief.place.neighborhood
    ? `${brief.place.neighborhood}${brief.place.city ? `, ${brief.place.city}` : ""}`
    : brief.place.city
      ? `${brief.place.city}${brief.place.state ? `, ${brief.place.state}` : ""}`
      : "your area";
  const first = brief.paragraphs[0]?.slice(0, 220) ?? "";

  await deliverPush({
    tokens: [token],
    dedupe: [{ slot: localBriefDedupeSlot(token.id), key }],
    eventKey: "local_brief",
    title: `Local economy — ${placeName}`,
    body: first || `What's investable in ${placeName} right now.`,
    data: {
      kind: "local_brief",
      lat: location.lat,
      lng: location.lng,
    },
    target: { type: "home", section: "local-brief" },
  });
}
