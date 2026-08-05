import type { MiddlewareHandler } from "hono";
import { verify } from "hono/jwt";
import type { Session, User } from "@mapvest/core";
import { sessionSigningKey } from "../lib/env.js";
import { getUserById } from "../lib/store.js";

export type AuthEnv = {
  Variables: {
    user: User;
    session: Session;
  };
};

/**
 * Requires a valid `Authorization: Bearer <session-jwt>` header.
 * Populates c.var.user and c.var.session on success.
 */
export const bearerAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const header = c.req.header("Authorization") ?? c.req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    return c.json({ error: "missing bearer token" }, 401);
  }
  const token = header.slice(7).trim();
  let payload: Record<string, unknown>;
  try {
    payload = (await verify(token, sessionSigningKey(), "HS256")) as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid token" }, 401);
  }
  if (payload.purpose !== "session") {
    return c.json({ error: "wrong token purpose" }, 401);
  }
  const userId = typeof payload.sub === "string" ? payload.sub : undefined;
  if (!userId) return c.json({ error: "invalid token subject" }, 401);
  const user = getUserById(userId);
  if (!user) return c.json({ error: "unknown user" }, 401);

  const expSec = typeof payload.exp === "number" ? payload.exp : 0;
  const session: Session = {
    token,
    userId,
    expiresAt: new Date(expSec * 1000).toISOString(),
  };
  c.set("user", user);
  c.set("session", session);
  await next();
};
