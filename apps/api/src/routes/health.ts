import { Hono } from "hono";

const health = new Hono();

health.get("/health", (c) =>
  c.json({ ok: true, service: "mapvest-api", timestamp: new Date().toISOString() }),
);

health.get("/config", (c) =>
  c.json({
    flags: {
      liveScan: process.env.ENABLE_LIVE_SCAN === "1",
      adminLogs: process.env.ENABLE_ADMIN_LOGS === "1",
    },
    version: process.env.RAILWAY_GIT_COMMIT_SHA ?? "dev",
  }),
);

export default health;
