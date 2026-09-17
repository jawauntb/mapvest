import { describe, expect, test } from "bun:test";
import type { PushToken } from "../src/lib/push-tokens-store.js";
import { _isRivalryCloseTick, _tokenFix, evaluateMovementForToken } from "../src/lib/scheduler.js";
import { isCycleCloseTick } from "../src/lib/weeklyCycle.js";

function makeToken(prefs: PushToken["prefs"]): PushToken {
  return {
    id: "ptk_test",
    userId: "usr_test",
    token: "ExponentPushToken[test]",
    platform: "ios",
    createdAt: new Date().toISOString(),
    prefs,
  } as PushToken;
}

describe("scheduler tokenFix", () => {
  test("returns coordinates for a fresh heartbeat", () => {
    const token = makeToken({
      last_lat: 40.7,
      last_lng: -74.0,
      last_location_at: new Date().toISOString(),
    });
    expect(_tokenFix(token)).toEqual({ lat: 40.7, lng: -74.0 });
  });

  test("tolerates a missing timestamp (legacy heartbeat)", () => {
    const token = makeToken({ last_lat: 40.7, last_lng: -74.0 });
    expect(_tokenFix(token)).toEqual({ lat: 40.7, lng: -74.0 });
  });

  test("rejects a stale fix so old locations never count as an arrival", () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const token = makeToken({
      last_lat: 40.7,
      last_lng: -74.0,
      last_location_at: twoDaysAgo,
    });
    expect(_tokenFix(token)).toBeNull();
  });

  test("rejects missing or non-finite coordinates", () => {
    expect(_tokenFix(makeToken({}))).toBeNull();
    expect(_tokenFix(makeToken({ last_lat: Number.NaN, last_lng: 1 }))).toBeNull();
  });
});

describe("rivalry weekly-close boundary", () => {
  test("the scheduler fires on the exact same predicate weeklyCycle.ts exports — no second implementation", () => {
    // Reference equality, not just agreeing behavior: this fails immediately
    // if the scheduler ever grows its own independent boundary check again.
    expect(_isRivalryCloseTick).toBe(isCycleCloseTick);
  });

  test("fires at Saturday 12:00 UTC and nowhere else", () => {
    expect(_isRivalryCloseTick(new Date("2026-09-19T12:00:00.000Z"))).toBe(true);
    expect(_isRivalryCloseTick(new Date("2026-09-19T11:59:00.000Z"))).toBe(false);
    expect(_isRivalryCloseTick(new Date("2026-09-18T12:00:00.000Z"))).toBe(false);
  });
});

describe("evaluateMovementForToken", () => {
  test("is a no-op when the push scheduler is disabled", async () => {
    const prev = process.env.ENABLE_PUSH_SCHEDULER;
    process.env.ENABLE_PUSH_SCHEDULER = "0";
    try {
      const token = makeToken({
        notifications_enabled: true,
        uncaught_nearby: true,
        local_brief: true,
        last_lat: 40.7,
        last_lng: -74.0,
        last_location_at: new Date().toISOString(),
      });
      // Would otherwise attempt the local-brief + nearby fan-out; disabled
      // scheduler must return without touching any notifier.
      await evaluateMovementForToken(token);
    } finally {
      process.env.ENABLE_PUSH_SCHEDULER = prev ?? "";
    }
  });
});
