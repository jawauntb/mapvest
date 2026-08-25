import { describe, expect, test } from "bun:test";
import {
  FIND_SURFACE_FOLLOW_UP_DELAY_MS,
  type FindSurfaceQueryClient,
  type FocusRefreshScheduler,
  findSurfaceQueryKeys,
  hasFindRefreshPending,
  markFindRefreshPending,
  refreshFindSurfacesOnFocus,
} from "./focusRefresh";
import { findsQueryKey, findsQueryKeyPrefix } from "./queryKeys";

function makeHarness() {
  const calls: unknown[] = [];
  let scheduled: (() => void) | undefined;
  let scheduledDelay = 0;
  let cleared = 0;
  const queryClient: FindSurfaceQueryClient = {
    invalidateQueries: (filters) => {
      calls.push(filters);
    },
  };
  const scheduler: FocusRefreshScheduler = {
    setTimeout: (callback, delayMs) => {
      scheduled = callback;
      scheduledDelay = delayMs;
      return "focus-refresh-timer";
    },
    clearTimeout: (handle) => {
      expect(handle).toBe("focus-refresh-timer");
      cleared += 1;
    },
  };
  return {
    calls,
    get scheduled() {
      return scheduled;
    },
    get scheduledDelay() {
      return scheduledDelay;
    },
    get cleared() {
      return cleared;
    },
    queryClient,
    scheduler,
  };
}

describe("find focus refresh", () => {
  test("uses limit-aware keys and a prefix that invalidates both projections", () => {
    expect(findsQueryKey("session-a", 100)).toEqual(["finds", "session-a", 100]);
    expect(findsQueryKey("session-a", 200)).toEqual(["finds", "session-a", 200]);
    expect(findsQueryKey("session-a", 100)).not.toEqual(findsQueryKey("session-a", 200));
    expect(findsQueryKeyPrefix("session-a")).toEqual(["finds", "session-a"]);
    expect(findSurfaceQueryKeys("session-a")).toEqual([
      ["finds", "session-a"],
      ["progress", "session-a"],
      ["universe-summary", "session-a"],
      ["dex", "session-a"],
      ["quests", "session-a"],
    ]);
  });

  test("pending markers are isolated by authenticated token", () => {
    const owner = makeHarness();
    const other = makeHarness();

    markFindRefreshPending("session-a");
    expect(hasFindRefreshPending("session-a")).toBe(true);
    expect(hasFindRefreshPending("session-b")).toBe(false);
    refreshFindSurfacesOnFocus(other.queryClient, "session-b", other.scheduler);
    expect(other.calls).toHaveLength(0);
    expect(other.scheduled).toBeUndefined();

    refreshFindSurfacesOnFocus(owner.queryClient, "session-a", owner.scheduler);
    owner.scheduled?.();
    expect(hasFindRefreshPending("session-a")).toBe(false);
  });

  test("ordinary and guest focus are no-ops", () => {
    const harness = makeHarness();

    expect(hasFindRefreshPending("ordinary-focus")).toBe(false);
    expect(
      refreshFindSurfacesOnFocus(harness.queryClient, "ordinary-focus", harness.scheduler),
    ).toBeFunction();
    expect(
      refreshFindSurfacesOnFocus(harness.queryClient, undefined, harness.scheduler),
    ).toBeFunction();
    expect(harness.calls).toHaveLength(0);
    expect(harness.scheduled).toBeUndefined();
  });

  test("a successful token marker refreshes immediately and once after the bounded window", () => {
    const harness = makeHarness();
    markFindRefreshPending("successful-identify");

    const cleanup = refreshFindSurfacesOnFocus(
      harness.queryClient,
      "successful-identify",
      harness.scheduler,
    );

    expect(harness.calls).toHaveLength(5);
    expect(harness.scheduledDelay).toBe(FIND_SURFACE_FOLLOW_UP_DELAY_MS);
    expect(harness.scheduled).toBeDefined();
    expect(harness.calls).toEqual(
      findSurfaceQueryKeys("successful-identify").map((queryKey) => ({
        queryKey,
        refetchType: "active",
      })),
    );

    harness.scheduled?.();
    expect(harness.calls).toHaveLength(10);
    expect(hasFindRefreshPending("successful-identify")).toBe(false);
    cleanup();
    expect(harness.cleared).toBe(0);
  });

  test("blur cancels the follow-up but preserves work for the next eligible focus", () => {
    const first = makeHarness();
    markFindRefreshPending("blurred-identify");
    const cleanup = refreshFindSurfacesOnFocus(
      first.queryClient,
      "blurred-identify",
      first.scheduler,
    );

    cleanup();
    first.scheduled?.();
    expect(first.calls).toHaveLength(5);
    expect(first.cleared).toBe(1);
    expect(hasFindRefreshPending("blurred-identify")).toBe(true);

    const next = makeHarness();
    const nextCleanup = refreshFindSurfacesOnFocus(
      next.queryClient,
      "blurred-identify",
      next.scheduler,
    );
    next.scheduled?.();
    nextCleanup();
    expect(next.calls).toHaveLength(10);
    expect(hasFindRefreshPending("blurred-identify")).toBe(false);
  });

  test("repeated focus does not create duplicate waves or timers", () => {
    const harness = makeHarness();
    markFindRefreshPending("repeated-focus");
    const cleanup = refreshFindSurfacesOnFocus(
      harness.queryClient,
      "repeated-focus",
      harness.scheduler,
    );
    const duplicateCleanup = refreshFindSurfacesOnFocus(
      harness.queryClient,
      "repeated-focus",
      harness.scheduler,
    );

    expect(harness.calls).toHaveLength(5);
    expect(harness.scheduled).toBeDefined();
    duplicateCleanup();
    cleanup();
    cleanup();
    expect(harness.cleared).toBe(1);
    expect(hasFindRefreshPending("repeated-focus")).toBe(true);
  });
});
