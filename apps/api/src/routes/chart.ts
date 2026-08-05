import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";

/**
 * Chart proxies over the sibling `underlying-analyzer-reboot` service.
 * Default surface: 1-month auction chart whenever a ticker is opened.
 *
 * Upstream: POST /api/charts/auction { ticker, period }
 * Docs: The Underlying Analyzer Reboot / docs/api.md
 */

const UNDERLYING_URL =
  process.env.UNDERLYING_URL ?? "https://underlying-terminal-production.up.railway.app";

const chart = new Hono();

type UpstreamImage = { filename?: string; mime?: string; data?: string };
type UpstreamChart = {
  images?: UpstreamImage[];
  provider?: string;
  provider_note?: string;
  meta?: { poc?: number; vah?: number; val?: number };
  error?: string;
};

/**
 * GET /v1/chart/auction?ticker=MCD&period=1m
 * → { ticker, period, image: { mime, data, filename? }, levels?, provider? }
 */
chart.get("/auction", async (c) => {
  return safeExecuteWithSpan("http.chart.auction", async (span) => {
    const ticker = (c.req.query("ticker") ?? "").trim().toUpperCase();
    const period = (c.req.query("period") ?? "1m").trim() || "1m";
    if (!ticker || !/^[A-Z][A-Z0-9.]{0,5}$/.test(ticker)) {
      return c.json({ error: "ticker required (e.g. MCD)" }, 400);
    }
    span.setAttributes({ ticker, period, upstream: UNDERLYING_URL });

    const started = performance.now();
    const res = await fetch(`${UNDERLYING_URL}/api/charts/auction`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ticker, period }),
    });
    span.setAttributes({
      upstream_status: res.status,
      upstream_latency_ms: Math.round(performance.now() - started),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return c.json(
        { error: `underlying auction chart ${res.status}`, detail: text.slice(0, 300) },
        502,
      );
    }

    const j = (await res.json()) as UpstreamChart;
    const img = j.images?.[0];
    if (!img?.data) {
      return c.json({ error: j.error ?? "no auction chart image returned" }, 502);
    }

    return c.json({
      ticker,
      period,
      image: {
        mime: img.mime ?? "image/png",
        data: img.data,
        filename: img.filename,
      },
      levels:
        j.meta && (j.meta.poc != null || j.meta.vah != null || j.meta.val != null)
          ? { poc: j.meta.poc, vah: j.meta.vah, val: j.meta.val }
          : undefined,
      provider: j.provider,
      providerNote: j.provider_note,
      sourceUrl: `${UNDERLYING_URL}/`,
    });
  });
});

export default chart;
