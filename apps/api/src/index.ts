import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { initDb } from "./lib/db.js";
import { startPushScheduler } from "./lib/scheduler.js";
import { metricsMiddleware } from "./middleware/metrics.js";
import { rateLimit } from "./middleware/rateLimit.js";
import admin from "./routes/admin.js";
import agent from "./routes/agent.js";
import priceAlerts from "./routes/alerts.js";
import analysis from "./routes/analysis.js";
import auth from "./routes/auth.js";
import backtest from "./routes/backtest.js";
import billing from "./routes/billing.js";
import billingWebhook from "./routes/billingWebhook.js";
import chart from "./routes/chart.js";
import cockpit, { alerts as underlyingAlerts } from "./routes/cockpit.js";
import entitlements from "./routes/entitlements.js";
import finds from "./routes/finds.js";
import health from "./routes/health.js";
import identify from "./routes/identify.js";
import localBrief from "./routes/localBrief.js";
import marketData from "./routes/market-data.js";
import marketEvents from "./routes/market-events.js";
import memo from "./routes/memo.js";
import nearby from "./routes/nearby.js";
import news from "./routes/news.js";
import options from "./routes/options.js";
import proxy from "./routes/proxy.js";
import push from "./routes/push.js";
import quoteHistory from "./routes/quote-history.js";
import quote from "./routes/quote.js";
import resolve from "./routes/resolve.js";
import robinhood from "./routes/robinhood.js";
import sessionRoutes from "./routes/session.js";
import settings from "./routes/settings.js";
import underlying from "./routes/underlying.js";
import watchlist from "./routes/watchlist.js";
import widget from "./routes/widget.js";

// Eager Postgres migrate (no-op when POSTGRES_URL unset).
void initDb().catch((err) => {
  console.error("[db] init failed", err);
});

// Opt-in push notifications scheduler. Requires ENABLE_PUSH_SCHEDULER=1 so
// local dev never accidentally fires production-shaped pushes; see
// lib/scheduler.ts for cadences.
startPushScheduler();

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
app.route("/v1/finds", finds);
app.route("/v1/nearby", nearby);
app.route("/v1/resolve-comparable", resolve);
app.route("/v1/quote", quote);
app.route("/v1/quote-history", quoteHistory);
app.route("/v1/news", news);
app.route("/v1/auth", auth);
app.route("/v1/session", sessionRoutes);
app.route("/v1/proxy", proxy);
app.route("/v1/admin", admin);
app.route("/v1/options", options);
app.route("/v1/market-data", marketData);
app.route("/v1/market-events", marketEvents);
app.route("/v1/underlying", underlying);
app.route("/v1/memo", memo);
app.route("/v1/chart", chart);
app.route("/v1/analysis", analysis);
app.route("/v1/cockpit", cockpit);
// Price alerts (user-authored triggers). Wins /v1/alerts.
app.route("/v1/alerts", priceAlerts);
// Legacy Underlying-Analyzer batch scan lives at a distinct path now.
app.route("/v1/underlying-alerts", underlyingAlerts);
app.route("/v1/backtest", backtest);
app.route("/v1/local-brief", localBrief);
app.route("/v1/agent", agent);
app.route("/v1/watchlist", watchlist);
app.route("/v1/settings", settings);
app.route("/v1/robinhood", robinhood);
app.route("/v1/entitlements", entitlements);
// Opt-in push notifications — token registration, per-event prefs.
app.route("/v1/push", push);
// Native widget backends — nearby list + map snapshot.
app.route("/v1/widget", widget);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error("[api]", err);
  return c.json({ error: err.message }, 500);
});

const port = Number(process.env.PORT ?? 3001);
console.log(`[api] listening on :${port}`);

export { app };
export default { port, fetch: app.fetch };
