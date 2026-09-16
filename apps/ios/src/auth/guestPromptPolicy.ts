import type { DexRarity } from "@/api/types";

/** Three convert moments. Rare/legendary wins when more than one is eligible. */
export type GuestPromptMoment = "second_find" | "rare_catch" | "backgrounded_return";

export const GUEST_PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const GUEST_PROMPT_RETURN_DAYS = 3;

const RARE_CATCH_TIERS: ReadonlySet<string> = new Set(["rare", "legendary"]);

export type GuestPromptInput = {
  signedIn: boolean;
  findsThisSession: number;
  /** ISO end of the winning moment's 24h deferral. Past or null = clear. */
  cooldownExpiresAt: string | null;
  daysSinceLastFind: number | null;
  latestRarity: DexRarity | null;
  now?: number;
};

const MOMENT_PRIORITY: readonly GuestPromptMoment[] = [
  "rare_catch",
  "second_find",
  "backgrounded_return",
];

export function daysSinceIso(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return (now - then) / 86_400_000;
}

export type GuestPromptCooldownMap = Partial<Record<GuestPromptMoment, string | null>>;

export function parseCooldownMap(raw: string | null): GuestPromptCooldownMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: GuestPromptCooldownMap = {};
    for (const moment of ["second_find", "rare_catch", "backgrounded_return"] as const) {
      const value = (parsed as Record<string, unknown>)[moment];
      if (typeof value === "string") out[moment] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function cooldownIsActive(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt);
  return Number.isFinite(ms) && ms > now;
}

export function eligibleGuestMoments(
  input: Pick<GuestPromptInput, "findsThisSession" | "daysSinceLastFind" | "latestRarity">,
): GuestPromptMoment[] {
  const out: GuestPromptMoment[] = [];
  if (input.latestRarity && RARE_CATCH_TIERS.has(input.latestRarity)) out.push("rare_catch");
  if (input.findsThisSession >= 2) out.push("second_find");
  if (input.daysSinceLastFind != null && input.daysSinceLastFind >= GUEST_PROMPT_RETURN_DAYS) {
    out.push("backgrounded_return");
  }
  return MOMENT_PRIORITY.filter((moment) => out.includes(moment));
}

/**
 * Which convert sheet (if any) to show. Signed-in users never prompt.
 * A live `cooldownExpiresAt` suppresses the winning moment only — use
 * `resolveGuestPrompt` when each moment has its own 24h key.
 */
export function shouldPromptGuest(input: GuestPromptInput): GuestPromptMoment | null {
  if (input.signedIn) return null;
  const [winning] = eligibleGuestMoments(input);
  if (!winning) return null;
  if (cooldownIsActive(input.cooldownExpiresAt, input.now)) return null;
  return winning;
}

/** Per-moment cooldown: if rare is cooling down, second_find can still fire. */
export function resolveGuestPrompt(
  input: GuestPromptInput & {
    cooldownByMoment?: Partial<Record<GuestPromptMoment, string | null>>;
  },
): GuestPromptMoment | null {
  if (input.signedIn) return null;
  const now = input.now ?? Date.now();
  for (const moment of eligibleGuestMoments(input)) {
    const expires = input.cooldownByMoment
      ? (input.cooldownByMoment[moment] ?? null)
      : input.cooldownExpiresAt;
    if (cooldownIsActive(expires, now)) continue;
    return moment;
  }
  return null;
}

export function guestPromptCopy(
  moment: GuestPromptMoment,
  latestRarity?: DexRarity | null,
): { title: string; body: string } {
  const title = "Keep what you've caught";
  if (moment === "rare_catch") {
    const kind = latestRarity === "legendary" ? "legendary" : "rare";
    return {
      title,
      body: `That's a ${kind} catch. Sign in to keep it in your universe.`,
    };
  }
  if (moment === "second_find") {
    return {
      title,
      body: "Sign in to keep these two finds — and every one after. Your universe is yours from that moment on.",
    };
  }
  return {
    title,
    body: "Sign in to keep your finds in your universe. Your streak starts the day you do.",
  };
}
