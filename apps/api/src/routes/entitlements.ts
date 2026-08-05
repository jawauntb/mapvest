import type { User } from "@mapvest/core";
import { Hono } from "hono";
import { getEntitlementState } from "../lib/entitlements.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { optionalAuth } from "../middleware/optionalAuth.js";
import { deviceIdFromRequest } from "../middleware/requireGenerationQuota.js";

const entitlements = new Hono();
entitlements.use("*", optionalAuth);

/**
 * GET /v1/entitlements
 * Auth optional (`Authorization: Bearer <session>`); anonymous callers
 * should also send `X-Device-Id` so remaining free-tier usage can be
 * tracked per-device. Mirrors the state consumed by requireGenerationQuota.
 */
entitlements.get("/", async (c) => {
  return safeExecuteWithSpan("http.entitlements", async (span) => {
    const user = (c as unknown as { get: (k: string) => User | undefined }).get("user");
    const deviceId = deviceIdFromRequest(c);
    span.setAttributes({ has_user: !!user, has_device_id: !!deviceId, user_id: user?.id });
    const state = await getEntitlementState({ userId: user?.id, deviceId, email: user?.email });
    return c.json(state);
  });
});

export default entitlements;
