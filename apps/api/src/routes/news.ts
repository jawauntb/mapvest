import { Hono } from "hono";
import {
  type JevMateriality,
  filterByMateriality,
  parseMaterialityFloor,
  scoreHeadlineMateriality,
} from "../lib/headline-materiality.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { fetchArticle } from "../lib/news-read.js";
import { type NewsItem, fetchTickerNews } from "../lib/news-source.js";
import { optionalAuth } from "../middleware/optionalAuth.js";

/** A `/v1/news` item; `jev_materiality` is optional and absent when unscored. */
export type TaggedNewsItem = NewsItem & { jev_materiality?: JevMateriality };

/**
 * GET /v1/news?ticker=AAPL&limit=6[&materiality=material]
 *
 * Returns a compact list of recent headlines for `ticker`, sourced from a
 * Massive reference news by default, with Yahoo RSS or Finnhub only when the
 * explicit fallback flag is set. Best-effort: on any provider failure the endpoint returns an empty
 * `items` array with `provider: "error"` and a 200 status — clients render
 * a graceful empty state rather than hitting an error path.
 *
 * Each item may carry an optional `jev_materiality` tag
 * (`{ level, score, confidence }`, see lib/headline-materiality.ts) from one
 * batched Jev call per page. The key is absent — never null — when Jev is
 * unconfigured, errored, or unsure, and the rest of the response is what it
 * was before. `?materiality=<noise|minor|material>` keeps items at or above
 * that level AND every unscored item; the floor applied is echoed back as
 * `materiality` (`null` when none).
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
    const floor = parseMaterialityFloor(c.req.query("materiality"));
    span.setAttributes({ ticker: ticker.toUpperCase(), limit, materiality: floor ?? "none" });

    const started = performance.now();
    const { items, provider } = await fetchTickerNews(ticker, limit);
    const latencyMs = Math.round(performance.now() - started);
    span.setAttributes({
      latency_ms: latencyMs,
      item_count: items.length,
      provider,
    });

    // Jev materiality tags — one batched call per page, fail-open, cached.
    const symbol = ticker.toUpperCase();
    const tags = await scoreHeadlineMateriality(
      items.map((it) => ({
        id: it.url,
        ticker: symbol,
        title: it.title,
        source: it.source,
        publishedAt: it.publishedAt,
      })),
      [symbol],
    );
    const tagged: TaggedNewsItem[] = items.map((it) => {
      const tag = tags[it.url];
      return tag ? { ...it, jev_materiality: tag } : it;
    });
    const filtered = filterByMateriality(tagged, floor);
    span.setAttributes({
      scored_count: Object.keys(tags).length,
      returned_count: filtered.length,
    });

    // Same caching envelope as /v1/quote: news moves slowly at the per-
    // minute scale but we still want to soak up bursty re-fetches from
    // the detail screen without slamming the upstream provider.
    c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.json({
      items: filtered,
      provider,
      ts: new Date().toISOString(),
      materiality: floor,
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
