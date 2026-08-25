import { describe, expect, test } from "bun:test";
import {
  FIND_SURFACE_FOLLOW_UP_DELAY_MS,
  type FindSurfaceQueryClient,
  type FocusRefreshScheduler,
  findSurfaceQueryKeys,
  refreshFindSurfacesOnFocus,
} from "./focusRefresh";

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
  test("builds token-scoped keys for every find surface", () => {
    expect(findSurfaceQueryKeys("session-a")).toEqual([
      ["finds", "session-a"],
      ["progress", "session-a"],
      ["universe-summary", "session-a"],
      ["dex", "session-a"],
      ["quests", "session-a"],
    ]);
  });

  test("refreshes immediately and schedules one bounded follow-up", () => {
    const harness = makeHarness();

    const cleanup = refreshFindSurfacesOnFocus(harness.queryClient, "session-a", harness.scheduler);

    expect(harness.calls).toHaveLength(5);
    expect(harness.scheduledDelay).toBe(FIND_SURFACE_FOLLOW_UP_DELAY_MS);
    expect(harness.scheduled).toBeDefined();
    expect(harness.calls).toEqual(
      findSurfaceQueryKeys("session-a").map((queryKey) => ({
        queryKey,
        refetchType: "active",
      })),
    );

    harness.scheduled?.();
    expect(harness.calls).toHaveLength(10);
    cleanup();
    expect(harness.cleared).toBe(1);
  });

  test("cleanup prevents a late follow-up and duplicate cleanup work", () => {
    const harness = makeHarness();

    const cleanup = refreshFindSurfacesOnFocus(harness.queryClient, "session-a", harness.scheduler);
    cleanup();
    cleanup();
    harness.scheduled?.();

    expect(harness.calls).toHaveLength(5);
    expect(harness.cleared).toBe(1);
  });

  test("does not schedule or refresh without a token", () => {
    const harness = makeHarness();

    const cleanup = refreshFindSurfacesOnFocus(harness.queryClient, "   ", harness.scheduler);
    cleanup();

    expect(harness.calls).toHaveLength(0);
    expect(harness.scheduled).toBeUndefined();
    expect(harness.cleared).toBe(0);
  });
});
