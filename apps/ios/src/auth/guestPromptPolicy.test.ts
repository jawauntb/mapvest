import { describe, expect, test } from "bun:test";
import {
  cooldownIsActive,
  daysSinceIso,
  guestPromptCopy,
  parseCooldownMap,
  resolveGuestPrompt,
  shouldPromptGuest,
} from "./guestPromptPolicy";

const NOW = Date.parse("2026-09-15T16:00:00.000Z");
const FUTURE = "2026-09-16T16:00:00.000Z";
const PAST = "2026-09-14T16:00:00.000Z";

const base = {
  signedIn: false,
  findsThisSession: 0,
  cooldownExpiresAt: null as string | null,
  daysSinceLastFind: null as number | null,
  latestRarity: null as "common" | "uncommon" | "rare" | "legendary" | null,
  now: NOW,
};

describe("shouldPromptGuest", () => {
  test("signed-in users never prompt, even on a rare second find", () => {
    expect(
      shouldPromptGuest({
        ...base,
        signedIn: true,
        findsThisSession: 2,
        latestRarity: "rare",
        daysSinceLastFind: 4,
      }),
    ).toBeNull();
  });

  test("second successful identify in a session → second_find", () => {
    expect(shouldPromptGuest({ ...base, findsThisSession: 2 })).toBe("second_find");
    expect(shouldPromptGuest({ ...base, findsThisSession: 1 })).toBeNull();
    expect(shouldPromptGuest({ ...base, findsThisSession: 0 })).toBeNull();
  });

  test("rare or legendary catch → rare_catch, and it wins over second_find", () => {
    expect(shouldPromptGuest({ ...base, findsThisSession: 1, latestRarity: "rare" })).toBe(
      "rare_catch",
    );
    expect(shouldPromptGuest({ ...base, findsThisSession: 1, latestRarity: "legendary" })).toBe(
      "rare_catch",
    );
    expect(shouldPromptGuest({ ...base, findsThisSession: 2, latestRarity: "legendary" })).toBe(
      "rare_catch",
    );
  });

  test("common and uncommon do not trigger rare_catch", () => {
    expect(shouldPromptGuest({ ...base, findsThisSession: 1, latestRarity: "common" })).toBeNull();
    expect(
      shouldPromptGuest({ ...base, findsThisSession: 1, latestRarity: "uncommon" }),
    ).toBeNull();
  });

  test("≥3 days since last find → backgrounded_return", () => {
    expect(shouldPromptGuest({ ...base, daysSinceLastFind: 3 })).toBe("backgrounded_return");
    expect(shouldPromptGuest({ ...base, daysSinceLastFind: 2.9 })).toBeNull();
    expect(shouldPromptGuest({ ...base, daysSinceLastFind: null })).toBeNull();
  });

  test("a live cooldownExpiresAt suppresses the winning moment", () => {
    expect(
      shouldPromptGuest({
        ...base,
        findsThisSession: 2,
        cooldownExpiresAt: FUTURE,
      }),
    ).toBeNull();
    expect(
      shouldPromptGuest({
        ...base,
        findsThisSession: 2,
        cooldownExpiresAt: PAST,
      }),
    ).toBe("second_find");
  });
});

describe("resolveGuestPrompt", () => {
  test("falls through to the next moment when the winner is cooling down", () => {
    expect(
      resolveGuestPrompt({
        ...base,
        findsThisSession: 2,
        latestRarity: "rare",
        cooldownByMoment: { rare_catch: FUTURE },
      }),
    ).toBe("second_find");
  });

  test("stays quiet when every eligible moment is cooling down", () => {
    expect(
      resolveGuestPrompt({
        ...base,
        findsThisSession: 2,
        daysSinceLastFind: 4,
        cooldownByMoment: { second_find: FUTURE, backgrounded_return: FUTURE },
      }),
    ).toBeNull();
  });
});

describe("parseCooldownMap", () => {
  test("keeps known moment timestamps and drops junk", () => {
    expect(parseCooldownMap(null)).toEqual({});
    expect(parseCooldownMap("{")).toEqual({});
    expect(
      parseCooldownMap(
        JSON.stringify({
          rare_catch: FUTURE,
          second_find: 12,
          extra: "nope",
        }),
      ),
    ).toEqual({ rare_catch: FUTURE });
  });
});

describe("daysSinceIso / cooldownIsActive", () => {
  test("daysSinceIso returns elapsed days or null", () => {
    expect(daysSinceIso("2026-09-12T16:00:00.000Z", NOW)).toBe(3);
    expect(daysSinceIso(null, NOW)).toBeNull();
    expect(daysSinceIso("not-a-date", NOW)).toBeNull();
  });

  test("cooldownIsActive is true only for a future ISO timestamp", () => {
    expect(cooldownIsActive(FUTURE, NOW)).toBe(true);
    expect(cooldownIsActive(PAST, NOW)).toBe(false);
    expect(cooldownIsActive(null, NOW)).toBe(false);
  });
});

describe("guestPromptCopy", () => {
  test("every moment uses canon language and the shared header", () => {
    const second = guestPromptCopy("second_find");
    expect(second.title).toBe("Keep what you've caught");
    expect(second.body).toContain("finds");
    expect(second.body).toContain("universe");

    const rare = guestPromptCopy("rare_catch", "rare");
    expect(rare.body).toContain("rare catch");
    expect(rare.body).toContain("universe");

    const legendary = guestPromptCopy("rare_catch", "legendary");
    expect(legendary.body).toContain("legendary catch");

    const returned = guestPromptCopy("backgrounded_return");
    expect(returned.body).toContain("universe");
    expect(returned.body).toContain("finds");
    expect(returned.body).toContain("streak");
  });
});
