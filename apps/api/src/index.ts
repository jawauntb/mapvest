import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { initDb } from "./lib/db.js";
import { metricsMiddleware } from "./middleware/metrics.js";
import { rateLimit } from "./middleware/rateLimit.js";
import admin from "./routes/admin.js";
import agent from "./routes/agent.js";
import analysis from "./routes/analysis.js";
import auth from "./routes/auth.js";
import billing from "./routes/billing.js";
import billingWebhook from "./routes/billingWebhook.js";
import chart from "./routes/chart.js";
import cockpit, { alerts } from "./routes/cockpit.js";
import entitlements from "./routes/entitlements.js";
import health from "./routes/health.js";
import identify from "./routes/identify.js";
import memo from "./routes/memo.js";
import nearby from "./routes/nearby.js";
import options from "./routes/options.js";
import proxy from "./routes/proxy.js";
import quote from "./routes/quote.js";
import resolve from "./routes/resolve.js";
import robinhood from "./routes/robinhood.js";
import sessionRoutes from "./routes/session.js";
import settings from "./routes/settings.js";
import underlying from "./routes/underlying.js";
import watchlist from "./routes/watchlist.js";

// Eager Postgres migrate (no-op when POSTGRES_URL unset).
void initDb().catch((err) => {
  console.error("[db] init failed", err);
});

const app = new Hono();
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    // X-Device-Id: anonymous per-device id sent by iOS/web clients so guest
    // usage can be metered without sign-in (Phase 8 Slice C groundwork).
    allowHeaders: ["Authorization", "Content-Type", "Accept", "X-Device-Id"],
  }),
);
// gzip/deflate JSON responses over 1KB (hono/compress default threshold).
// Uses the standard CompressionStream API, supported natively by Bun.
app.use("*", compress());
app.use("*", metricsMiddleware);
app.use("*", rateLimit());

app.route("/v1", health);
// Webhook MUST be mounted before /v1/billing (bearerAuth) and before any
// JSON body-parsing route — Stripe signature verification needs the raw
// body, read directly in billingWebhook.ts via c.req.text().
app.route("/v1/billing/webhook", billingWebhook);
app.route("/v1/billing", billing);
app.route("/v1/identify", identify);
app.route("/v1/nearby", nearby);
app.route("/v1/resolve-comparable", resolve);
app.route("/v1/quote", quote);
app.route("/v1/auth", auth);
app.route("/v1/session", sessionRoutes);
app.route("/v1/proxy", proxy);
app.route("/v1/admin", admin);
app.route("/v1/options", options);
app.route("/v1/underlying", underlying);
app.route("/v1/memo", memo);
app.route("/v1/chart", chart);
app.route("/v1/analysis", analysis);
app.route("/v1/cockpit", cockpit);
app.route("/v1/alerts", alerts);
app.route("/v1/agent", agent);
app.route("/v1/watchlist", watchlist);
app.route("/v1/settings", settings);
app.route("/v1/robinhood", robinhood);
app.route("/v1/entitlements", entitlements);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error("[api]", err);
  return c.json({ error: err.message }, 500);
});

const port = Number(process.env.PORT ?? 3001);
console.log(`[api] listening on :${port}`);

export { app };
export default { port, fetch: app.fetch };
