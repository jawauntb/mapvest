import type { User } from "@mapvest/core";
import type { MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";
import { sessionSigningKey } from "../lib/env.js";
import { ensureUser, getUserById } from "../lib/store.js";

/**
 * Best-effort session auth for billable-but-anon-friendly routes (identify,
 * agent chat, memo). Populates `user` on the context when a valid session
 * bearer token is present; never blocks the request when the header is
 * missing or the token is invalid/expired — anonymous callers fall through
 * to `X-Device-Id` quota tracking in `requireGenerationQuota`.
 *
 * Untyped (like ./identifyGuards.ts) so it composes onto any router
 * regardless of that router's Hono generic; reads/writes the context via a
 * narrow structural cast rather than requiring every mounting router to
 * share one Env type.
 */
export const optionalAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("Authorization") ?? c.req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    try {
      const payload = (await verify(token, sessionSigningKey(), "HS256")) as Record<
        string,
        unknown
      >;
      if (payload.purpose === "session") {
        const userId = typeof payload.sub === "string" ? payload.sub : undefined;
        const email = typeof payload.email === "string" ? payload.email : undefined;
        if (userId) {
          const user: User | undefined =
            (await getUserById(userId)) ?? (email ? await ensureUser(userId, email) : undefined);
          if (user) (c as unknown as { set: (k: string, v: unknown) => void }).set("user", user);
        }
      }
    } catch {
      // invalid/expired token — treat the caller as anonymous instead of failing the request
    }
  }
  await next();
};
