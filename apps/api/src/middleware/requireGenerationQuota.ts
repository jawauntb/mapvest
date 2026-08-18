import type { User } from "@mapvest/core";
import type { MiddlewareHandler } from "hono";
import { MONTHLY_PRICE_USD, getEntitlementState, recordGeneration } from "../lib/entitlements.js";

const MAX_DEVICE_ID_LEN = 128;

/** Reads + validates the `X-Device-Id` header (anon-caller identity, a client-generated UUID). */
export function deviceIdFromRequest(c: {
  req: { header: (n: string) => string | undefined };
}): string | undefined {
  const raw = c.req.header("X-Device-Id") ?? c.req.header("x-device-id");
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 && trimmed.length <= MAX_DEVICE_ID_LEN ? trimmed : undefined;
}

/**
 * Gates a billable generation (identify / agent chat / memo) behind the
 * Phase 8 free-tier quota (see lib/entitlements.ts). Must run after
 * `optionalAuth` so `c.get("user")` is populated for signed-in callers;
 * anonymous callers are metered by `X-Device-Id` instead, and requests with
 * neither are rejected outright.
 *
 * Records the usage event only once the wrapped handler completes
 * successfully (status < 400), so failed upstream calls don't burn quota.
 */
export function requireGenerationQuota(kind: string): MiddlewareHandler {
  return async (c, next) => {
    const user = (c as unknown as { get: (k: string) => User | undefined }).get("user");
    const deviceId = deviceIdFromRequest(c);
    if (!user && !deviceId) {
      return c.json({ error: "X-Device-Id header required for anonymous requests" }, 400);
    }

    const state = await getEntitlementState({ userId: user?.id, deviceId, email: user?.email });
    if (!state.canGenerate) {
      return c.json(
        {
          error: "generation quota exceeded",
          code: "quota_exceeded" as const,
          remaining: state.remaining,
          limit: state.limit,
          priceUsd: MONTHLY_PRICE_USD,
          interval: "month" as const,
        },
        402,
      );
    }

    await next();

    if (c.res.status < 400) {
      await recordGeneration({ userId: user?.id, deviceId, kind });
    }
  };
}
