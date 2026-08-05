import type { MiddlewareHandler } from "hono";
import type { AuthEnv } from "./bearerAuth.js";

export const requireAdmin: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "auth required" }, 401);
  if (!user.scopes?.includes("admin")) {
    return c.json({ error: "admin scope required" }, 403);
  }
  await next();
};
