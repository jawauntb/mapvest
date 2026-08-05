import { createHash } from "node:crypto";
import { Hono } from "hono";
import { bearerAuth, type AuthEnv } from "../middleware/bearerAuth.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";

/**
 * Per-user settings. Robinhood MCP credentials are stored server-side only
 * (never returned raw). Research chat still uses Derivation's operator MCP
 * unless/until we wire per-user credential forwarding upstream.
 */

type RobinhoodMcpSettings = {
  fingerprint: string;
  last4: string;
  updatedAt: string;
  hasCredential: true;
};

const robinhoodByUser = new Map<string, { token: string; meta: RobinhoodMcpSettings }>();

function fingerprintToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

const settings = new Hono<AuthEnv>();
settings.use("*", bearerAuth);

/** GET /v1/settings → account + masked integrations */
settings.get("/", (c) => {
  return safeExecuteWithSpan("http.settings.get", (span) => {
    const user = c.get("user");
    const rh = robinhoodByUser.get(user.id)?.meta ?? null;
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
      note:
        "Research chat uses Derivation Research Console server credentials by default. A personal Robinhood MCP token is stored masked for future per-user routing — never returned in full.",
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
    const meta: RobinhoodMcpSettings = {
      fingerprint: fingerprintToken(token),
      last4: token.slice(-4),
      updatedAt: new Date().toISOString(),
      hasCredential: true,
    };
    robinhoodByUser.set(user.id, { token, meta });
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
settings.delete("/robinhood-mcp", (c) => {
  return safeExecuteWithSpan("http.settings.robinhood_mcp_clear", (span) => {
    const user = c.get("user");
    robinhoodByUser.delete(user.id);
    span.setAttributes({ user_id: user.id });
    return c.json({ ok: true, robinhoodMcp: { configured: false as const } });
  });
});

export default settings;
