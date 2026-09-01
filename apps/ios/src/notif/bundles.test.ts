import { describe, expect, test } from "bun:test";
import {
  NOTIFICATION_BUNDLES,
  notificationBundlePatch,
  notificationBundleState,
  notificationBundleValueLabel,
} from "./bundles";

describe("notification bundles", () => {
  test("groups every bundled event once and leaves daily and price alerts individual", () => {
    expect(NOTIFICATION_BUNDLES.flatMap((bundle) => bundle.events)).toEqual([
      "uncaught_nearby",
      "local_brief",
      "identify_done",
      "watchlist_mover",
      "find_evolution",
      "memo_finished",
      "agent_response",
    ]);
  });

  test("reports off, partial, and on while patching a bundle atomically", () => {
    const nearby = NOTIFICATION_BUNDLES[0]!;
    expect(notificationBundleState({}, nearby)).toBe("off");
    expect(notificationBundleState({ uncaught_nearby: true }, nearby)).toBe("some");
    expect(notificationBundleState(notificationBundlePatch(nearby, true), nearby)).toBe("on");
    expect(notificationBundleValueLabel("some")).toBe("Some on");
    expect(notificationBundlePatch(nearby, false)).toEqual({
      uncaught_nearby: false,
      local_brief: false,
      identify_done: false,
    });
  });
});
