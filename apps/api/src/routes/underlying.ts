import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";

const underlying = new Hono();

/**
 * GET /v1/underlying?brand=XYZ&sector=abc
 *
 * v0.1 scaffold — private-company sector proxies live in the sibling repo
 * `the-underlying-analyzer-reboot` and are deferred to v0.2. Today this
 * endpoint returns a link-out so the iOS + landing surface can point users
 * at the sibling project without pretending we already ship the math.
 *
 * Mirrors the options.ts scaffold. See docs/SYSTEM_DESIGN.md D10 for the
 * "sibling repo boundary" call: we treat the underlying analyzer as an
 * external service accessed by URL, not vendored into this repo.
 *
 * Unlike /v1/options, `brand` is optional here — the underlying analyzer
 * is designed to work from a brand name (private companies rarely have a
 * ticker) plus an optional sector hint. We still surface whatever the
 * caller sent back in the response so clients can round-trip params.
 */
underlying.get("/", (c) => {
  return safeExecuteWithSpan("http.underlying", (span) => {
    const brand = c.req.query("brand");
    const sector = c.req.query("sector");
    span.setAttributes({
      brand: brand ?? "",
      sector: sector ?? "",
      link_out: "the-underlying-analyzer-reboot",
      deferred_to: "v0.2",
    });
    return c.json({
      linkOut: "https://underlying-terminal-production.up.railway.app/",
      note: "underlying-analyzer link-out — live sibling instance",
      brand,
      sector,
    });
  });
});

export default underlying;
