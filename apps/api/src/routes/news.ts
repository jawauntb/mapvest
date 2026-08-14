import { Hono } from "hono";
import { fetchArticle } from "../lib/news-read.js";
import { fetchTickerNews } from "../lib/news-source.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { optionalAuth } from "../middleware/optionalAuth.js";

/**
 * GET /v1/news?ticker=AAPL&limit=6
 *
 * Returns a compact list of recent headlines for `ticker`, sourced from a
 * keyless Yahoo Finance RSS by default (or Finnhub when FINNHUB_API_KEY is
 * set). Best-effort: on any provider failure the endpoint returns an empty
 * `items` array with `provider: "error"` and a 200 status — clients render
 * a graceful empty state rather than hitting an error path.
 *
 * `optionalAuth` mirrors the memo/agent pattern: it does not gate access,
 * but populates the user context if a valid session bearer is present so
 * future per-user personalization has a hook.
 */
const news = new Hono();

news.get("/", optionalAuth, async (c) => {
  return safeExecuteWithSpan("http.news", async (span) => {
    const ticker = (c.req.query("ticker") ?? "").trim();
    if (!ticker) {
      span.setAttribute("error.kind", "missing_ticker");
      return c.json({ error: "ticker required" }, 400);
    }
    const limitRaw = Number(c.req.query("limit"));
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(25, Math.floor(limitRaw)) : 6;
    span.setAttributes({ ticker: ticker.toUpperCase(), limit });

    const started = performance.now();
    const { items, provider } = await fetchTickerNews(ticker, limit);
    const latencyMs = Math.round(performance.now() - started);
    span.setAttributes({
      latency_ms: latencyMs,
      item_count: items.length,
      provider,
    });

    // Same caching envelope as /v1/quote: news moves slowly at the per-
    // minute scale but we still want to soak up bursty re-fetches from
    // the detail screen without slamming Yahoo.
    c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.json({
      items,
      provider,
      ts: new Date().toISOString(),
    });
  });
});

news.get("/read", optionalAuth, async (c) => {
  return safeExecuteWithSpan("http.news_read", async (span) => {
    const url = (c.req.query("url") ?? "").trim();
    if (!url) {
      span.setAttribute("error.kind", "missing_url");
      return c.json({ error: "url required" }, 400);
    }
    span.setAttribute("article_url", url.slice(0, 200));
    const article = await fetchArticle(url);
    span.setAttributes({
      has_text: article.text.length > 0,
      read_error: article.error ?? "",
    });
    c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    return c.json(article);
  });
});

export default news;
