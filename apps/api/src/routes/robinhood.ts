import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { hasRobinhoodMcp, robinhoodStockUrl } from "../lib/robinhood-mcp.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

/**
 * GET /v1/robinhood?ticker=JPM
 *
 * Returns a Robinhood stock deep-link when the user has connected a personal
 * Robinhood MCP key (Home settings). Mapvest does not place orders — the user
 * buys/sells inside Robinhood (app or agentic trading).
 */

const robinhood = new Hono<AuthEnv>();
robinhood.use("*", bearerAuth);

robinhood.get("/", async (c) => {
  return safeExecuteWithSpan("http.robinhood.open", async (span) => {
    const raw = c.req.query("ticker") ?? "";
    const ticker = raw.trim().toUpperCase();
    if (!ticker || !/^[A-Z][A-Z0-9.]{0,5}$/.test(ticker)) {
      return c.json({ error: "ticker required" }, 400);
    }
    const user = c.get("user");
    const configured = await hasRobinhoodMcp(user.id);
    span.setAttributes({
      user_id: user.id,
      ticker,
      robinhood_mcp_configured: configured,
    });
    if (!configured) {
      return c.json(
        {
          error: "robinhood_mcp_not_configured",
          note: "Connect a Robinhood MCP key under Home → settings first.",
        },
        403,
      );
    }
    const linkOut = robinhoodStockUrl(ticker);
    return c.json({
      ticker,
      configured: true as const,
      linkOut,
      note: "Opens Robinhood stock page so you can buy or place an order there. Mapvest never submits broker orders.",
    });
  });
});

export default robinhood;
