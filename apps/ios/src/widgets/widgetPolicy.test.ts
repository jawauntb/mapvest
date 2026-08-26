import { describe, expect, test } from "bun:test";
import {
  type WidgetCapturedFix,
  type WidgetRegistrationContext,
  widgetFixRelayDecision,
} from "./widgetPolicy";

const registeredAt = Date.parse("2026-08-25T11:00:00.000Z");
const now = Date.parse("2026-08-25T12:00:00.000Z");
const registration: WidgetRegistrationContext = {
  accountId: "account-a",
  epoch: "epoch-a",
  registeredAt,
};
const fix: WidgetCapturedFix = {
  lat: 40.7128,
  lng: -74.006,
  capturedAt: registeredAt + 60_000,
  accountId: "account-a",
  registrationEpoch: "epoch-a",
};

function decide(candidate: Partial<WidgetCapturedFix> | null, context = registration) {
  return widgetFixRelayDecision({
    fix: candidate,
    registration: context,
    now,
    maxAgeMs: 6 * 60 * 60 * 1000,
  });
}

describe("widgetFixRelayDecision", () => {
  test("requires an active registration context", () => {
    expect(widgetFixRelayDecision({ fix, registration: null, now, maxAgeMs: 1_000 })).toEqual({
      ok: false,
      reason: "no-registration",
    });
  });

  test("rejects guest and previous-account fixes", () => {
    expect(decide({ ...fix, accountId: "account-b" })).toEqual({
      ok: false,
      reason: "account-mismatch",
    });
    expect(decide({ ...fix, registrationEpoch: "epoch-old" })).toEqual({
      ok: false,
      reason: "epoch-mismatch",
    });
  });

  test("rejects fixes captured before registration", () => {
    expect(decide({ ...fix, capturedAt: registeredAt - 1 })).toEqual({
      ok: false,
      reason: "pre-registration",
    });
  });

  test("rejects invalid, stale, and future fixes", () => {
    expect(decide({ ...fix, lat: 91 })).toEqual({ ok: false, reason: "invalid-coordinate" });
    expect(
      decide(
        { ...fix, capturedAt: now - 6 * 60 * 60 * 1000 - 1 },
        { ...registration, registeredAt: 0 },
      ),
    ).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(decide({ ...fix, capturedAt: now + 1 })).toEqual({ ok: false, reason: "future" });
  });

  test("accepts a recent fix for the current account and epoch", () => {
    expect(decide(fix)).toEqual({ ok: true });
  });
});
