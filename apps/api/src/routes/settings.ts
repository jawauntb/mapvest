import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { clearRobinhoodMcp, getRobinhoodMcp, setRobinhoodMcp } from "../lib/robinhood-mcp.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

/**
 * Per-user settings. Robinhood MCP credentials are stored encrypted in Postgres
 * (never returned raw). Personal tokens gate "Open in Robinhood" deep-links —
 * Mapvest does not submit broker orders.
 */

const settings = new Hono<AuthEnv>();
settings.use("*", bearerAuth);

/** GET /v1/settings → account + masked integrations */
settings.get("/", async (c) => {
  return safeExecuteWithSpan("http.settings.get", async (span) => {
    const user = c.get("user");
    const rh = (await getRobinhoodMcp(user.id)) ?? null;
    span.setAttributes({ user_id: user.id, has_robinhood_mcp: !!rh });
    return c.json({
      user: { id: user.id, email: user.email, scopes: user.scopes },
      robinhoodMcp: rh
        ? {
            configured: true as const,
            fingerprint: rh.fingerprint,
            last4: rh.last4,
            updatedAt: rh.updatedAt,
          }
        : { configured: false as const },
      note: "Paste your Robinhood agent MCP bearer under Home to unlock Open in Robinhood on ticker pages. Mapvest opens Robinhood for you to place orders there — we never submit broker orders. Key is encrypted in Postgres and survives redeploys.",
    });
  });
});

/**
 * POST /v1/settings/robinhood-mcp
 * Body: { token: string } — Robinhood agent MCP bearer (from ChatGPT connector / agent.robinhood.com).
 */
settings.post("/robinhood-mcp", async (c) => {
  return safeExecuteWithSpan("http.settings.robinhood_mcp", async (span) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (token.length < 20 || token.length > 8000) {
      return c.json({ error: "token required (20–8000 chars)" }, 400);
    }
    const meta = await setRobinhoodMcp(user.id, token);
    span.setAttributes({ user_id: user.id, fingerprint: meta.fingerprint });
    return c.json({
      ok: true,
      robinhoodMcp: {
        configured: true as const,
        fingerprint: meta.fingerprint,
        last4: meta.last4,
        updatedAt: meta.updatedAt,
      },
    });
  });
});

/** DELETE /v1/settings/robinhood-mcp */
settings.delete("/robinhood-mcp", async (c) => {
  return safeExecuteWithSpan("http.settings.robinhood_mcp_clear", async (span) => {
    const user = c.get("user");
    await clearRobinhoodMcp(user.id);
    span.setAttributes({ user_id: user.id });
    return c.json({ ok: true, robinhoodMcp: { configured: false as const } });
  });
});

export default settings;
