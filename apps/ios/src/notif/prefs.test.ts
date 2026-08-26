import { describe, expect, test } from "bun:test";
import {
  buildExpiredSessionRevokeRequest,
  buildPushRevokeRequest,
  isSuccessfulPushRevocation,
} from "./revokeOutcome";

const identity = { expoToken: "ExponentPushToken[test-token]", deviceId: "device-a" };

describe("push revocation endpoint contracts", () => {
  test("uses the public exact-claim endpoint when a token id exists", () => {
    const request = buildPushRevokeRequest("https://api.test", identity, "claim-a");
    expect(request.url).toBe("https://api.test/v1/push/revoke-device");
    expect(request.body).toMatchObject({ tokenId: "claim-a" });
    expect(request.headers).not.toHaveProperty("Authorization");
  });

  test("uses the authenticated current-device endpoint when the id is missing", () => {
    const request = buildPushRevokeRequest("https://api.test", identity, null, {
      token: "session-b",
    });
    expect(request.url).toBe("https://api.test/v1/push/revoke-current-device");
    expect(request.body).not.toHaveProperty("tokenId");
    expect(request.headers).toMatchObject({ Authorization: "Bearer session-b" });
  });

  test("uses the expired-session endpoint with an opaque id even when Expo identity is unavailable", () => {
    const request = buildExpiredSessionRevokeRequest(
      "https://api.test",
      null,
      { token: "expired-session-a" },
      "claim-a",
    );
    expect(request.url).toBe("https://api.test/v1/push/revoke-expired-session-device");
    expect(request.body).toEqual({ tokenId: "claim-a" });
    expect(request.headers).toMatchObject({ Authorization: "Bearer expired-session-a" });
  });

  test("expired-session recovery can carry persisted Expo proof without a token id", () => {
    const request = buildExpiredSessionRevokeRequest("https://api.test", identity, {
      token: "expired-session-a",
    });
    expect(request.body).toEqual({ token: identity.expoToken, deviceId: identity.deviceId });
  });

  test("does not construct a token-only public revoke request", () => {
    expect(() => buildPushRevokeRequest("https://api.test", identity)).toThrow(
      "claimant id or an authenticated session",
    );
  });

  test("accepts freshly revoked and idempotently already-revoked outcomes", () => {
    expect(isSuccessfulPushRevocation({ revoked: true, outcome: "revoked", matched: true })).toBe(
      true,
    );
    expect(
      isSuccessfulPushRevocation({ revoked: true, outcome: "already-revoked", matched: false }),
    ).toBe(true);
  });

  test("rejects claim mismatch and malformed 2xx responses", () => {
    expect(
      isSuccessfulPushRevocation({ revoked: true, outcome: "claim-mismatch", matched: false }),
    ).toBe(false);
    expect(isSuccessfulPushRevocation({ matched: true })).toBe(false);
  });
});
