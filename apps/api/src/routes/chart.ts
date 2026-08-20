import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import {
  UNDERLYING_URL,
  isTicker,
  normalizePeriod,
  upstreamFetch,
} from "../lib/underlying.js";

/**
 * Chart proxies → underlying-analyzer-reboot `POST /api/charts/<type>`.
 *
 * GET /v1/chart/:type?ticker=MCD&period=1mo&interval=1d&month=1
 */

const CHART_TYPES = new Set([
  "auction",
  "performance",
  "regression",
  "ridge-growth",
  "ridge_growth",
  "flow-compass",
  "flow_compass",
  "torque",
  "portfolio",
  "volatility",
]);

const chart = new Hono();

type UpstreamImage = { filename?: string; mime?: string; data?: string };
type UpstreamChart = {
  images?: UpstreamImage[];
  provider?: string;
  provider_note?: string;
  meta?: Record<string, unknown>;
  error?: string;
};

function normalizeType(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, "-");
}

chart.get("/:type", async (c) => {
  return safeExecuteWithSpan("http.chart", async (span) => {
    const type = normalizeType(c.req.param("type") ?? "");
    if (!CHART_TYPES.has(type) && !CHART_TYPES.has(type.replace(/-/g, "_"))) {
      return c.json(
        {
          error: `unsupported chart type (use auction|performance|regression|ridge-growth|flow-compass|torque)`,
        },
        400,
      );
    }
    const ticker = (c.req.query("ticker") ?? "").trim().toUpperCase();
    if (!isTicker(ticker)) {
      return c.json({ error: "ticker required (e.g. MCD)" }, 400);
    }
    const defaultPeriod = type === "auction" ? "1mo" : type === "torque" ? "2y" : "1y";
    const period = normalizePeriod(c.req.query("period") ?? undefined, defaultPeriod);
    const interval = (c.req.query("interval") ?? "1d").trim().toLowerCase() || "1d";
    if (!["15m", "15min", "1d", "1w", "1wk"].includes(interval)) {
      return c.json({ error: "interval must be 15m, 1d, or 1w" }, 400);
    }
    const monthRaw = c.req.query("month");
    const month = monthRaw ? Number(monthRaw) : undefined;

    span.setAttributes({ chart_type: type, ticker, period, interval, upstream: UNDERLYING_URL });

    const body: Record<string, unknown> = { ticker, period, interval };
    if (type === "performance" && Number.isFinite(month) && month! >= 1 && month! <= 12) {
      body.month = month;
    }

    const started = performance.now();
    const res = await upstreamFetch(`/api/charts/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 45_000,
    });
    span.setAttributes({
      upstream_status: res.status,
      upstream_latency_ms: Math.round(performance.now() - started),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return c.json(
        { error: `underlying chart ${type} ${res.status}`, detail: text.slice(0, 300) },
        502,
      );
    }

    const j = (await res.json()) as UpstreamChart;
    const img = j.images?.[0];
    if (!img?.data) {
      return c.json({ error: j.error ?? "no chart image returned" }, 502);
    }

    const meta = j.meta ?? {};
    const levels =
      typeof meta.poc === "number" || typeof meta.vah === "number" || typeof meta.val === "number"
        ? {
            poc: typeof meta.poc === "number" ? meta.poc : undefined,
            vah: typeof meta.vah === "number" ? meta.vah : undefined,
            val: typeof meta.val === "number" ? meta.val : undefined,
          }
        : undefined;

    return c.json({
      ticker,
      type,
      period,
      interval,
      image: {
        mime: img.mime ?? "image/png",
        data: img.data,
        filename: img.filename,
      },
      levels,
      meta,
      provider: j.provider,
      providerNote: j.provider_note,
      sourceUrl: `${UNDERLYING_URL}/`,
    });
  });
});

export default chart;
