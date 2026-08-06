import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";

const options = new Hono();

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

export default options;
