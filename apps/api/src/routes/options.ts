import {
  MarketDataProviderError,
  getOptionContract,
  getOptionContracts,
  getOptionsChain,
} from "@mapvest/finance";
import { type Context, Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { marketDataSource } from "../lib/marketDataSource.js";
import { marketDataRateLimit } from "../middleware/marketDataRateLimit.js";

const options = new Hono();

function limitOf(raw: string | undefined, fallback: number, maximum = 1_000): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(1, Math.min(maximum, Math.floor(value))) : fallback;
}

function optionError(c: Context, error: unknown) {
  if (error instanceof MarketDataProviderError && error.status === 429) {
    return c.json({ error: "market data rate limited" }, 429);
  }
  if (error instanceof MarketDataProviderError && error.status === 503) {
    return c.json({ error: "market data provider not configured" }, 503);
  }
  return c.json({ error: "options data unavailable" }, 502);
}

/**
 * GET /v1/options?ticker=XYZ
 *
 * v0.1 scaffold — options-chain derivation lives in the sibling repo
 * `~/option_derivation` and is deferred to v0.2. For now we return a
 * link-out so the iOS + landing surface can point users at the sibling
 * project without pretending we already ship the math.
 *
 * See docs/SYSTEM_DESIGN.md D10 for the "sibling repo boundary" call:
 * we treat option_derivation as an external service accessed by URL,
 * not vendored into this repo.
 */
options.get("/", (c) => {
  return safeExecuteWithSpan("http.options", (span) => {
    const ticker = c.req.query("ticker");
    if (!ticker) {
      span.setAttribute("error.kind", "missing_ticker");
      return c.json({ error: "ticker required" }, 400);
    }
    span.setAttributes({
      ticker,
      link_out: "option_derivation",
      deferred_to: "v0.2",
    });
    // Static link-out scaffold — the response is a pure function of the
    // query string with no I/O, so it is safe to cache for longer than the
    // dynamic routes.
    c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    return c.json({
      ticker,
      linkOut: "https://github.com/jawauntb/option_derivation",
      note: "options derivation deferred to v0.2",
    });
  });
});

/** Additive Massive-backed option-chain snapshot. */
options.get("/chain", marketDataRateLimit, async (c) => {
  const underlyingTicker = (c.req.query("underlying") ?? c.req.query("ticker") ?? "")
    .trim()
    .toUpperCase();
  if (!underlyingTicker) return c.json({ error: "underlying required" }, 400);
  const strikePriceRaw = c.req.query("strike_price");
  const strikePrice = strikePriceRaw ? Number(strikePriceRaw) : undefined;
  if (strikePriceRaw && !Number.isFinite(strikePrice)) {
    return c.json({ error: "strike_price must be a number" }, 400);
  }
  try {
    const page = await getOptionsChain({
      underlyingTicker,
      expirationDate: c.req.query("expiration_date"),
      contractType:
        c.req.query("contract_type") === "put"
          ? "put"
          : c.req.query("contract_type") === "call"
            ? "call"
            : undefined,
      strikePrice,
      limit: limitOf(c.req.query("limit"), 250, 250),
      cursor: c.req.query("cursor"),
    });
    return c.json({
      underlyingTicker,
      contracts: page.results,
      nextCursor: page.nextCursor,
      requestId: page.requestId,
      sources: [marketDataSource()],
    });
  } catch (error) {
    return optionError(c, error);
  }
});

/** Additive Massive-backed options contract index with cursor pass-through. */
options.get("/contracts", marketDataRateLimit, async (c) => {
  const strikePriceRaw = c.req.query("strike_price");
  const strikePrice = strikePriceRaw ? Number(strikePriceRaw) : undefined;
  if (strikePriceRaw && !Number.isFinite(strikePrice)) {
    return c.json({ error: "strike_price must be a number" }, 400);
  }
  try {
    const page = await getOptionContracts({
      underlyingTicker: c.req.query("underlying")?.trim().toUpperCase(),
      ticker: c.req.query("ticker")?.trim().toUpperCase(),
      expirationDate: c.req.query("expiration_date"),
      asOf: c.req.query("as_of"),
      contractType:
        c.req.query("contract_type") === "put"
          ? "put"
          : c.req.query("contract_type") === "call"
            ? "call"
            : undefined,
      strikePrice,
      expired:
        c.req.query("expired") === "true"
          ? true
          : c.req.query("expired") === "false"
            ? false
            : undefined,
      limit: limitOf(c.req.query("limit"), 100),
      cursor: c.req.query("cursor"),
    });
    return c.json({
      contracts: page.results,
      nextCursor: page.nextCursor,
      requestId: page.requestId,
      sources: [marketDataSource()],
    });
  } catch (error) {
    return optionError(c, error);
  }
});

options.get("/contracts/:ticker", marketDataRateLimit, async (c) => {
  const ticker = c.req.param("ticker").trim().toUpperCase();
  if (!ticker) return c.json({ error: "contract ticker required" }, 400);
  try {
    const contract = await getOptionContract(ticker);
    if (!contract) return c.json({ error: "option contract unavailable" }, 502);
    return c.json({ contract, sources: [marketDataSource()] });
  } catch (error) {
    return optionError(c, error);
  }
});

export default options;
