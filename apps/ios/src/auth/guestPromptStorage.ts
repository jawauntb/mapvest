import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  GUEST_FINDS_STORAGE_KEY,
  GUEST_LAST_FIND_AT_KEY,
  type GuestFindDraft,
  mergeGuestFind,
  parseGuestJournal,
} from "./guestFindJournal";
import {
  GUEST_PROMPT_COOLDOWN_MS,
  type GuestPromptCooldownMap,
  type GuestPromptMoment,
  parseCooldownMap,
} from "./guestPromptPolicy";

export const FIRST_OPEN_STORAGE_KEY = "mapvest.firstOpen.v1";
export const GUEST_PROMPT_COOLDOWN_KEY = "mapvest.guestPromptCooldown.v1";

let findsThisSession = 0;

export function getGuestFindsThisSession(): number {
  return findsThisSession;
}

export function incrementGuestFindsThisSession(): number {
  findsThisSession += 1;
  return findsThisSession;
}

export function resetGuestFindsThisSession(): void {
  findsThisSession = 0;
}

/** Fail closed: a throw means first-open still owns the slot. */
export async function hasSeenFirstOpen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(FIRST_OPEN_STORAGE_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function readGuestLastFindAt(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(GUEST_LAST_FIND_AT_KEY);
  } catch {
    return null;
  }
}

export async function writeGuestLastFindAt(iso: string): Promise<void> {
  try {
    await AsyncStorage.setItem(GUEST_LAST_FIND_AT_KEY, iso);
  } catch {
    /* identify must still succeed */
  }
}

export async function readGuestJournal(): Promise<GuestFindDraft[]> {
  try {
    return parseGuestJournal(await AsyncStorage.getItem(GUEST_FINDS_STORAGE_KEY));
  } catch {
    return [];
  }
}

export async function appendGuestFind(find: GuestFindDraft): Promise<GuestFindDraft[]> {
  const next = mergeGuestFind(await readGuestJournal(), find);
  try {
    await AsyncStorage.setItem(GUEST_FINDS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* keep going — the in-memory session count still drives the prompt */
  }
  return next;
}

export async function clearGuestJournal(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([GUEST_FINDS_STORAGE_KEY, GUEST_LAST_FIND_AT_KEY]);
  } catch {
    /* sign-in already happened */
  }
}

export async function readGuestPromptCooldowns(): Promise<GuestPromptCooldownMap> {
  try {
    return parseCooldownMap(await AsyncStorage.getItem(GUEST_PROMPT_COOLDOWN_KEY));
  } catch {
    return {};
  }
}

export async function markGuestPromptShown(
  moment: GuestPromptMoment,
  now = Date.now(),
): Promise<void> {
  const next = {
    ...(await readGuestPromptCooldowns()),
    [moment]: new Date(now + GUEST_PROMPT_COOLDOWN_MS).toISOString(),
  };
  try {
    await AsyncStorage.setItem(GUEST_PROMPT_COOLDOWN_KEY, JSON.stringify(next));
  } catch {
    /* dismissing still hides the sheet this session */
  }
}
