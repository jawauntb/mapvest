import { describe, expect, test } from "bun:test";

import {
  FIND_EVOLUTION_OPT_IN_PREFS,
  type FindEvolutionDevicePrefsDependencies,
  type FindEvolutionOptInDependencies,
  enableFindEvolutionOptIn,
  findEvolutionNudgeDismissalKey,
  getFindEvolutionDevicePrefs,
  resolveFindEvolutionEnrollmentCompletion,
  serializeFindEvolutionOptIn,
  shouldOfferFindEvolutionNudge,
} from "./findEvolutionOptIn";

const session = { token: "session-token" };

function dependencies(
  overrides: Partial<FindEvolutionOptInDependencies> = {},
): FindEvolutionOptInDependencies {
  return {
    requestPermission: async () => true,
    register: async () => ({ tokenId: "push_123" }),
    persist: async () => ({ ...FIND_EVOLUTION_OPT_IN_PREFS }),
    ...overrides,
  };
}

describe("Find evolution nudge eligibility", () => {
  test("requires a signed-in public result with a finite positive found price", () => {
    const eligible = {
      userId: "user-1",
      isPublic: true,
      ticker: "MCD",
      foundPrice: 250,
      dismissed: false,
    };

    expect(shouldOfferFindEvolutionNudge(eligible)).toBe(true);
    expect(shouldOfferFindEvolutionNudge({ ...eligible, userId: undefined })).toBe(false);
    expect(shouldOfferFindEvolutionNudge({ ...eligible, isPublic: false })).toBe(false);
    expect(shouldOfferFindEvolutionNudge({ ...eligible, ticker: "" })).toBe(false);
    expect(shouldOfferFindEvolutionNudge({ ...eligible, foundPrice: 0 })).toBe(false);
    expect(shouldOfferFindEvolutionNudge({ ...eligible, foundPrice: Number.NaN })).toBe(false);
  });

  test("respects a local dismissal and either prior Settings choice", () => {
    const candidate = {
      userId: "user-1",
      isPublic: true,
      ticker: "MCD",
      foundPrice: 250,
      dismissed: false,
    };

    expect(shouldOfferFindEvolutionNudge({ ...candidate, dismissed: true })).toBe(false);
    expect(
      shouldOfferFindEvolutionNudge({ ...candidate, existingFindEvolutionPreference: true }),
    ).toBe(false);
    expect(
      shouldOfferFindEvolutionNudge({ ...candidate, existingFindEvolutionPreference: false }),
    ).toBe(false);
  });

  test("scopes the one-time dismissal to the signed-in user", () => {
    expect(findEvolutionNudgeDismissalKey("user/one")).toBe(
      "mapvest.findEvolutionNudge.v1.user%2Fone",
    );
    expect(findEvolutionNudgeDismissalKey("user-one")).not.toBe(
      findEvolutionNudgeDismissalKey("user-two"),
    );
  });

  test("reads preferences only through the locally stored device token", async () => {
    const calls: Array<string | null | undefined> = [];
    const dependencies: FindEvolutionDevicePrefsDependencies = {
      readStoredTokenId: async () => "this-device",
      readPushPrefs: async (_session, tokenId) => {
        calls.push(tokenId);
        return {
          tokenId: "this-device",
          prefs: { find_evolution: false },
        };
      },
    };

    const remote = await getFindEvolutionDevicePrefs(session, dependencies);

    expect(calls).toEqual(["this-device"]);
    expect(remote.prefs.find_evolution).toBe(false);
  });

  test("does not fetch an arbitrary account device when this install has no stored token", async () => {
    let requests = 0;
    const remote = await getFindEvolutionDevicePrefs(session, {
      readStoredTokenId: async () => null,
      readPushPrefs: async () => {
        requests += 1;
        return { tokenId: "another-device", prefs: { find_evolution: true } };
      },
    });

    expect(requests).toBe(0);
    expect(remote).toEqual({ tokenId: null, prefs: {} });
  });

  test("does not fall back to another device when the stored token is stale", async () => {
    const calls: Array<string | null | undefined> = [];
    const dependencies: FindEvolutionDevicePrefsDependencies = {
      readStoredTokenId: async () => "stale-device",
      readPushPrefs: async (_session, tokenId) => {
        calls.push(tokenId);
        return tokenId === "stale-device"
          ? { tokenId: null, prefs: {} }
          : { tokenId: "replacement-device", prefs: { find_evolution: true } };
      },
    };

    const remote = await getFindEvolutionDevicePrefs(session, dependencies);

    expect(calls).toEqual(["stale-device"]);
    expect(remote).toEqual({ tokenId: null, prefs: {} });
  });
});

describe("Find evolution enrollment", () => {
  test("hides a newer Camera candidate after the same account successfully enrolls", () => {
    const firstCandidate = {};
    const newerCandidate = {};
    const action = {
      userId: "user-1",
      sessionToken: "session-token",
      candidate: firstCandidate,
    };

    expect(
      resolveFindEvolutionEnrollmentCompletion({ status: "enabled" }, action, {
        ...action,
        candidate: newerCandidate,
      }),
    ).toBe("hidden");
    expect(
      resolveFindEvolutionEnrollmentCompletion({ status: "enabled" }, action, {
        ...action,
        userId: "another-user",
        candidate: newerCandidate,
      }),
    ).toBe("ignore");
  });

  test("does not surface a failed older enrollment on a newer Camera result", () => {
    const firstCandidate = {};
    const newerCandidate = {};
    const action = {
      userId: "user-1",
      sessionToken: "session-token",
      candidate: firstCandidate,
    };

    expect(
      resolveFindEvolutionEnrollmentCompletion({ status: "permission-denied" }, action, {
        ...action,
        candidate: newerCandidate,
      }),
    ).toBe("ignore");
  });

  test("persists only master delivery and the Find evolution event after permission and registration", async () => {
    const calls: string[] = [];
    const result = await enableFindEvolutionOptIn(
      session,
      dependencies({
        requestPermission: async () => {
          calls.push("permission");
          return true;
        },
        register: async (receivedSession) => {
          calls.push(`register:${receivedSession.token}`);
          return { tokenId: "push_123" };
        },
        persist: async (tokenId, prefs, receivedSession) => {
          calls.push(`persist:${tokenId}:${receivedSession.token}`);
          expect(prefs).toEqual({ notifications_enabled: true, find_evolution: true });
          return { ...prefs };
        },
      }),
    );

    expect(result).toEqual({ status: "enabled" });
    expect(calls).toEqual([
      "permission",
      "register:session-token",
      "persist:push_123:session-token",
    ]);
  });

  test("does not register or write preferences when permission is denied", async () => {
    let registered = false;
    let persisted = false;
    const result = await enableFindEvolutionOptIn(
      session,
      dependencies({
        requestPermission: async () => false,
        register: async () => {
          registered = true;
          return { tokenId: "push_123" };
        },
        persist: async () => {
          persisted = true;
          return { ...FIND_EVOLUTION_OPT_IN_PREFS };
        },
      }),
    );

    expect(result).toEqual({ status: "permission-denied" });
    expect(registered).toBe(false);
    expect(persisted).toBe(false);
  });

  test("does not claim success when the server response lacks either requested preference", async () => {
    const result = await enableFindEvolutionOptIn(
      session,
      dependencies({ persist: async () => ({ notifications_enabled: true }) }),
    );

    expect(result).toEqual({ status: "persistence-failed" });
  });

  test("serializes rapid enable attempts into one enrollment", async () => {
    let permissionRequests = 0;
    let allowPermission: ((allowed: boolean) => void) | undefined;
    const permission = new Promise<boolean>((resolve) => {
      allowPermission = resolve;
    });
    const enable = serializeFindEvolutionOptIn(
      session,
      dependencies({
        requestPermission: async () => {
          permissionRequests += 1;
          return permission;
        },
      }),
    );

    const first = enable();
    const second = enable();
    expect(first).toBe(second);
    expect(permissionRequests).toBe(1);

    allowPermission?.(true);
    await expect(first).resolves.toEqual({ status: "enabled" });
  });
});
