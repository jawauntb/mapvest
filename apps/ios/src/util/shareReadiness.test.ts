import { describe, expect, test } from "bun:test";
import { canStartShareAttempt, isShareCardReady } from "./shareReadiness";

describe("universe share readiness", () => {
  test("waits for both layout and the local brand mark", () => {
    expect(isShareCardReady({ laidOut: false, brandMarkLoaded: false })).toBe(false);
    expect(isShareCardReady({ laidOut: true, brandMarkLoaded: false })).toBe(false);
    expect(isShareCardReady({ laidOut: false, brandMarkLoaded: true })).toBe(false);
    expect(isShareCardReady({ laidOut: true, brandMarkLoaded: true })).toBe(true);
  });

  test("rejects duplicate taps while a share attempt is in flight", () => {
    expect(canStartShareAttempt({ ready: false, inFlight: false })).toBe(false);
    expect(canStartShareAttempt({ ready: true, inFlight: true })).toBe(false);
    expect(canStartShareAttempt({ ready: true, inFlight: false })).toBe(true);
  });
});
