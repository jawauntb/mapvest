import { recordFinds } from "@/api/finds";
import type { FetchOpts } from "@/api/http";
import type { DexRarity } from "@/api/types";
import { DeviceEventEmitter } from "react-native";
import {
  type GuestFindDraft,
  type GuestFindSource,
  guestFindFromInvestable,
  toRecordFindInput,
} from "./guestFindJournal";
import { type GuestPromptMoment, daysSinceIso, resolveGuestPrompt } from "./guestPromptPolicy";
import {
  appendGuestFind,
  clearGuestJournal,
  hasSeenFirstOpen,
  incrementGuestFindsThisSession,
  readGuestJournal,
  readGuestLastFindAt,
  readGuestPromptCooldowns,
  resetGuestFindsThisSession,
  writeGuestLastFindAt,
} from "./guestPromptStorage";

export const GUEST_PROMPT_EVENT = "mapvest.guestPrompt";

export type GuestPromptEvent = {
  moment: GuestPromptMoment;
  rarity?: GuestFindDraft["rarity"];
};

export function emitGuestPrompt(payload: GuestPromptEvent): void {
  DeviceEventEmitter.emit(GUEST_PROMPT_EVENT, payload);
}

/**
 * After a guest identify lands a primary Investable: journal it, then maybe
 * emit a convert moment. Signed-in callers no-op — identify already records.
 */
export async function noteGuestIdentify(input: {
  signedIn: boolean;
  investable: GuestFindSource;
  location?: { lat?: number; lng?: number };
  foundPrice?: number;
  now?: Date;
}): Promise<GuestPromptMoment | null> {
  if (input.signedIn) return null;
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const draft = guestFindFromInvestable(input.investable, {
    lat: input.location?.lat,
    lng: input.location?.lng,
    foundPrice: input.foundPrice,
    createdAt,
  });
  await appendGuestFind(draft);
  await writeGuestLastFindAt(createdAt);
  const findsThisSession = incrementGuestFindsThisSession();
  return maybeEmitGuestPrompt({
    findsThisSession,
    latestRarity: draft.rarity ?? null,
    daysSinceLastFind: 0,
    now: now.getTime(),
  });
}

/** AppState foreground (and returning-guest mount) — never call on first-open. */
export async function noteGuestForeground(input: {
  signedIn: boolean;
  now?: Date;
}): Promise<GuestPromptMoment | null> {
  if (input.signedIn) return null;
  if (!(await hasSeenFirstOpen())) return null;
  const now = input.now ?? new Date();
  return maybeEmitGuestPrompt({
    findsThisSession: 0,
    latestRarity: null,
    daysSinceLastFind: daysSinceIso(await readGuestLastFindAt(), now.getTime()),
    now: now.getTime(),
  });
}

async function maybeEmitGuestPrompt(input: {
  findsThisSession: number;
  latestRarity: DexRarity | null;
  daysSinceLastFind: number | null;
  now: number;
}): Promise<GuestPromptMoment | null> {
  if (!(await hasSeenFirstOpen())) return null;
  const moment = resolveGuestPrompt({
    signedIn: false,
    findsThisSession: input.findsThisSession,
    cooldownExpiresAt: null,
    daysSinceLastFind: input.daysSinceLastFind,
    latestRarity: input.latestRarity,
    cooldownByMoment: await readGuestPromptCooldowns(),
    now: input.now,
  });
  if (!moment) return null;
  emitGuestPrompt({ moment, rarity: input.latestRarity ?? undefined });
  return moment;
}

/**
 * Move the local guest journal onto the signed-in account. Empty journal is
 * a no-op. Failures leave the journal so a later sign-in can retry.
 */
export async function replayGuestFinds(opts: FetchOpts): Promise<number> {
  const journal = await readGuestJournal();
  if (journal.length === 0) {
    resetGuestFindsThisSession();
    return 0;
  }
  const chronological = [...journal].reverse().map(toRecordFindInput);
  await recordFinds(chronological, opts);
  await clearGuestJournal();
  resetGuestFindsThisSession();
  return journal.length;
}
