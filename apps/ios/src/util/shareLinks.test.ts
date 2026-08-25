import { describe, expect, test } from "bun:test";
import { MAPVEST_URL, investableShareUrl, redirectMapvestWebPath } from "./shareLinks";

describe("investableShareUrl", () => {
  test("uses the canonical public domain and normalizes a cashtag", () => {
    expect(investableShareUrl("$AAPL")).toBe("https://www.mapvest.app/app/ticker/AAPL");
  });

  test("encodes an unresolved brand for the web resolver", () => {
    expect(investableShareUrl("Joe & The Juice")).toBe(
      "https://www.mapvest.app/app/ticker/Joe%20%26%20The%20Juice",
    );
  });

  test("falls back to the web app when no target is available", () => {
    expect(investableShareUrl("  ")).toBe(`${MAPVEST_URL}/app`);
    expect(investableShareUrl("$")).toBe(`${MAPVEST_URL}/app`);
  });
});

describe("redirectMapvestWebPath", () => {
  test("maps the apex-domain ticker URL to native detail", () => {
    expect(redirectMapvestWebPath("https://mapvest.app/app/ticker/NVDA")).toBe("/detail/NVDA");
  });

  test("maps www and encoded brand URLs", () => {
    expect(
      redirectMapvestWebPath("https://www.mapvest.app/app/ticker/Joe%20%26%20The%20Juice"),
    ).toBe("/detail/Joe%20%26%20The%20Juice");
  });

  test("maps the path shape Expo may supply without an origin", () => {
    expect(redirectMapvestWebPath("/app/ticker/MSFT")).toBe("/detail/MSFT");
  });

  test("does not rewrite off-domain or unrelated URLs", () => {
    expect(redirectMapvestWebPath("https://example.com/app/ticker/NVDA")).toBe(
      "https://example.com/app/ticker/NVDA",
    );
    expect(redirectMapvestWebPath("https://mapvest.app/docs/architecture")).toBe(
      "https://mapvest.app/docs/architecture",
    );
  });
});
