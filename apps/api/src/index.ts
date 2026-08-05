import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import identify from "./routes/identify.js";
import nearby from "./routes/nearby.js";
import resolve from "./routes/resolve.js";
import health from "./routes/health.js";

const app = new Hono();
app.use("*", logger());
app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

app.route("/v1", health);
app.route("/v1/identify", identify);
app.route("/v1/nearby", nearby);
app.route("/v1/resolve-comparable", resolve);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error("[api]", err);
  return c.json({ error: err.message }, 500);
});

const port = Number(process.env.PORT ?? 3001);
console.log(`[api] listening on :${port}`);

export default { port, fetch: app.fetch };
