/**
 * The push revoke endpoint is idempotent, but a claim mismatch is not
 * success: it means this caller did not prove ownership of the live row.
 * Keep the parser strict so a malformed 2xx cannot clear local cleanup state.
 */
export type PushRevokeOutcome = "revoked" | "already-revoked" | "claim-mismatch";

export type PushRevokeIdentity = { expoToken: string; deviceId?: string };

export function buildExpiredSessionRevokeRequest(
  apiUrl: string,
  identity: PushRevokeIdentity | null,
  session: { token: string },
  tokenId?: string | null,
): {
  url: string;
  headers: Record<string, string>;
  body: { token?: string; deviceId?: string; tokenId?: string };
} {
  if (!identity && !tokenId) {
    throw new Error("Expired-session cleanup needs a claimant id or Expo token.");
  }
  return {
    url: `${apiUrl}/v1/push/revoke-expired-session-device`,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: {
      ...(identity ? { token: identity.expoToken } : {}),
      ...(identity?.deviceId ? { deviceId: identity.deviceId } : {}),
      ...(tokenId ? { tokenId } : {}),
    },
  };
}

export function buildPushRevokeRequest(
  apiUrl: string,
  identity: PushRevokeIdentity,
  tokenId?: string | null,
  session?: { token: string },
): {
  url: string;
  headers: Record<string, string>;
  body: { token: string; deviceId?: string; tokenId?: string };
} {
  const authenticated = !tokenId && Boolean(session);
  if (!tokenId && !authenticated) {
    throw new Error("This device needs a claimant id or an authenticated session.");
  }
  return {
    url: tokenId ? `${apiUrl}/v1/push/revoke-device` : `${apiUrl}/v1/push/revoke-current-device`,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: {
      token: identity.expoToken,
      ...(identity.deviceId ? { deviceId: identity.deviceId } : {}),
      ...(tokenId ? { tokenId } : {}),
    },
  };
}

export function isSuccessfulPushRevocation(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const result = body as {
    revoked?: unknown;
    outcome?: unknown;
  };
  return (
    result.revoked === true &&
    (result.outcome === "revoked" || result.outcome === "already-revoked")
  );
}
