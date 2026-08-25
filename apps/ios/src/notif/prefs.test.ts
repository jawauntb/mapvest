import { describe, expect, test } from "bun:test";
import { buildPushRevokeRequest, isSuccessfulPushRevocation } from "./revokeOutcome";

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
