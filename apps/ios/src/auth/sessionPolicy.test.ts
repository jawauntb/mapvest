import { describe, expect, test } from "bun:test";
import {
  authFailureNeedsPushCleanup,
  secureStoreReadNeedsPushCleanup,
  sessionExpired,
} from "./sessionPolicy";

describe("session push cleanup policy", () => {
  test("expired sessions require cleanup before boot drops them", () => {
    const now = Date.parse("2026-08-25T12:00:00.000Z");
    expect(sessionExpired("2026-08-25T11:59:59.000Z", now)).toBe(true);
    expect(sessionExpired("2026-08-25T12:00:01.000Z", now)).toBe(false);
  });

  test("every 401 is treated as invalid-session cleanup", () => {
    expect(authFailureNeedsPushCleanup(401)).toBe(true);
    expect(authFailureNeedsPushCleanup(500)).toBe(false);
  });

  test("a SecureStore timeout is not treated as proof there is no session", () => {
    expect(secureStoreReadNeedsPushCleanup(true)).toBe(true);
    expect(secureStoreReadNeedsPushCleanup(false)).toBe(false);
  });
});
