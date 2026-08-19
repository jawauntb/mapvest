import { OptionBarsRequest, OptionSummaryRequest } from "@mapvest/core";
import {
  MarketDataProviderError,
  getOptionAggregatesPage,
  getOptionContract,
  getOptionContracts,
  getOptionSnapshot,
  getOptionsChain,
} from "@mapvest/finance";
import { type Context, Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { marketDataSource } from "../lib/marketDataSource.js";
import { parseMarketDate } from "../lib/marketDataValidation.js";
import { marketDataRateLimit } from "../middleware/marketDataRateLimit.js";

const options = new Hono();

const MARKET_TICKER_RE = /^[A-Z][A-Z0-9._-]{0,14}$/;
const OPTION_TICKER_RE = /^O:[A-Z0-9._-]{1,48}$/;

function limitOf(raw: string | undefined, fallback: number, maximum = 1_000): number | undefined {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= maximum ? value : undefined;
}

function cursorOf(raw: string | undefined): string | undefined {
  return raw !== undefined && /^[^\s]{1,2048}$/.test(raw) ? raw : undefined;
}

function validDate(raw: string | undefined): boolean {
  return raw === undefined || parseMarketDate(raw) !== undefined;
}

function validTicker(raw: string | undefined, pattern: RegExp): boolean {
  return raw === undefined || pattern.test(raw);
}

function contractTypeOf(raw: string | undefined): "call" | "put" | undefined | null {
  if (raw === undefined) return undefined;
  return raw === "call" || raw === "put" ? raw : null;
}

function booleanOf(raw: string | undefined): boolean | undefined | null {
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

function optionError(c: Context, error: unknown) {
  if (error instanceof MarketDataProviderError && error.status === 429) {
    return c.json({ error: "market data rate limited" }, 429);
  }
  if (error instanceof MarketDataProviderError && error.status === 503) {
    return c.json({ error: "market data provider not configured" }, 503);
  }
  if (error instanceof MarketDataProviderError && error.status === 501) {
    return c.json({ error: "options data unsupported" }, 501);
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
  if (!MARKET_TICKER_RE.test(underlyingTicker)) {
    return c.json({ error: "underlying must be a valid ticker" }, 400);
  }
  const strikePriceRaw = c.req.query("strike_price");
  const strikePrice = strikePriceRaw ? Number(strikePriceRaw) : undefined;
  if (strikePriceRaw && (!Number.isFinite(strikePrice) || strikePrice < 0)) {
    return c.json({ error: "strike_price must be a number" }, 400);
  }
  const contractType = contractTypeOf(c.req.query("contract_type"));
  const limit = limitOf(c.req.query("limit"), 250, 250);
  const cursor = cursorOf(c.req.query("cursor"));
  if (
    !validDate(c.req.query("expiration_date")) ||
    contractType === null ||
    limit === undefined ||
    (c.req.query("cursor") !== undefined && cursor === undefined)
  ) {
    return c.json({ error: "invalid options query" }, 400);
  }
  try {
    const page = await getOptionsChain({
      underlyingTicker,
      expirationDate: c.req.query("expiration_date"),
      contractType: contractType ?? undefined,
      strikePrice,
      limit,
      cursor,
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
  if (strikePriceRaw && (!Number.isFinite(strikePrice) || strikePrice < 0)) {
    return c.json({ error: "strike_price must be a number" }, 400);
  }
  const underlying = c.req.query("underlying")?.trim().toUpperCase();
  const ticker = c.req.query("ticker")?.trim().toUpperCase();
  const contractType = contractTypeOf(c.req.query("contract_type"));
  const expired = booleanOf(c.req.query("expired"));
  const limit = limitOf(c.req.query("limit"), 100);
  const cursor = cursorOf(c.req.query("cursor"));
  if (
    !validTicker(underlying, MARKET_TICKER_RE) ||
    !validTicker(ticker, OPTION_TICKER_RE) ||
    !validDate(c.req.query("expiration_date")) ||
    !validDate(c.req.query("as_of")) ||
    contractType === null ||
    expired === null ||
    limit === undefined ||
    (c.req.query("cursor") !== undefined && cursor === undefined)
  ) {
    return c.json({ error: "invalid options query" }, 400);
  }
  try {
    const page = await getOptionContracts({
      underlyingTicker: underlying,
      ticker,
      expirationDate: c.req.query("expiration_date"),
      asOf: c.req.query("as_of"),
      contractType: contractType ?? undefined,
      strikePrice,
      expired,
      limit,
      cursor,
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
  if (!OPTION_TICKER_RE.test(ticker)) {
    return c.json({ error: "contract ticker must be valid" }, 400);
  }
  try {
    const contract = await getOptionContract(ticker);
    if (!contract) return c.json({ error: "option contract unavailable" }, 502);
    return c.json({ contract, sources: [marketDataSource()] });
  } catch (error) {
    return optionError(c, error);
  }
});

/** Additive Massive-backed single option summary. */
options.get("/summary", marketDataRateLimit, async (c) => {
  const parsed = OptionSummaryRequest.safeParse({
    underlying: (c.req.query("underlying") ?? "").trim().toUpperCase(),
    contract: (c.req.query("contract") ?? "").trim().toUpperCase(),
  });
  if (!parsed.success) return c.json({ error: "underlying and contract required" }, 400);

  const { underlying, contract } = parsed.data;
  try {
    const summary = await getOptionSnapshot({
      underlyingTicker: underlying,
      optionTicker: contract,
    });
    if (!summary) return c.json({ error: "option summary unavailable" }, 404);
    return c.json({
      underlyingTicker: underlying,
      contractTicker: contract,
      summary,
      sources: [marketDataSource()],
    });
  } catch (error) {
    return optionError(c, error);
  }
});

/** Additive option OHLCV bars with opaque cursor continuation. */
options.get("/bars", marketDataRateLimit, async (c) => {
  const parsed = OptionBarsRequest.safeParse({
    ticker: (c.req.query("ticker") ?? "").trim().toUpperCase(),
    from: c.req.query("from"),
    to: c.req.query("to"),
    multiplier: c.req.query("multiplier"),
    timespan: c.req.query("timespan"),
    adjusted: c.req.query("adjusted"),
    cursor: c.req.query("cursor"),
  });
  if (!parsed.success) return c.json({ error: "invalid option bars query" }, 400);
  if (
    parseMarketDate(parsed.data.from) === undefined ||
    parseMarketDate(parsed.data.to) === undefined
  ) {
    return c.json({ error: "invalid option bars date" }, 400);
  }
  if (parsed.data.from > parsed.data.to) {
    return c.json({ error: "from must be on or before to" }, 400);
  }

  const { ticker, from, to, multiplier, timespan, adjusted, cursor } = parsed.data;
  try {
    const page = await getOptionAggregatesPage({
      optionTicker: ticker,
      from,
      to,
      multiplier,
      timespan,
      adjusted,
      ...(cursor ? { cursor } : {}),
    });
    return c.json({
      contractTicker: ticker,
      from,
      to,
      multiplier,
      timespan,
      points: page.points,
      nextCursor: page.nextCursor,
      requestId: page.requestId,
      sources: [marketDataSource()],
    });
  } catch (error) {
    return optionError(c, error);
  }
});

export default options;
