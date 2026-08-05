import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import identify from "./routes/identify.js";
import nearby from "./routes/nearby.js";
import resolve from "./routes/resolve.js";
import quote from "./routes/quote.js";
import health from "./routes/health.js";
import auth from "./routes/auth.js";
import sessionRoutes from "./routes/session.js";
import proxy from "./routes/proxy.js";
import admin from "./routes/admin.js";
import options from "./routes/options.js";
import underlying from "./routes/underlying.js";
import memo from "./routes/memo.js";
import chart from "./routes/chart.js";
import analysis from "./routes/analysis.js";
import cockpit, { alerts } from "./routes/cockpit.js";
import agent from "./routes/agent.js";
import watchlist from "./routes/watchlist.js";
import settings from "./routes/settings.js";
import robinhood from "./routes/robinhood.js";
import { metricsMiddleware } from "./middleware/metrics.js";
import { rateLimit } from "./middleware/rateLimit.js";

const app = new Hono();
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "Accept"],
  }),
);
app.use("*", metricsMiddleware);
app.use("*", rateLimit());

app.route("/v1", health);
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

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error("[api]", err);
  return c.json({ error: err.message }, 500);
});

const port = Number(process.env.PORT ?? 3001);
console.log(`[api] listening on :${port}`);

export { app };
export default { port, fetch: app.fetch };
