import { describe, expect, test } from "bun:test";
import { apiBase, price, printKeyValue, printTable, readFlag, signed } from "../src/util.js";

describe("util.apiBase", () => {
  test("defaults to production Railway host when MAPVEST_API_URL is missing", () => {
    expect(apiBase({})).toBe("https://api-production-4b27.up.railway.app");
  });
  test("honors MAPVEST_API_URL and trims trailing slashes", () => {
    expect(apiBase({ MAPVEST_API_URL: "http://localhost:8787/" })).toBe("http://localhost:8787");
    expect(apiBase({ MAPVEST_API_URL: "http://localhost:8787///" })).toBe("http://localhost:8787");
  });
});

describe("util.signed / price", () => {
  test("signed prefixes positives with + and passes negatives through", () => {
    expect(signed(1.234)).toBe("+1.23");
    expect(signed(-1.234)).toBe("-1.23");
    expect(signed(0)).toBe("0.00");
  });
  test("price formats to two decimals by default", () => {
    expect(price(12.345)).toBe("12.35");
  });
});

describe("util.readFlag", () => {
  test("reads --flag value form", () => {
    expect(readFlag(["--lat", "37.77"], "lat")).toBe("37.77");
  });
  test("reads --flag=value form", () => {
    expect(readFlag(["--lat=37.77"], "lat")).toBe("37.77");
  });
  test("returns undefined when absent", () => {
    expect(readFlag(["--lng", "1"], "lat")).toBeUndefined();
  });
});

describe("util.printKeyValue / printTable", () => {
  test("printKeyValue skips undefined/null/empty and aligns keys", () => {
    const out: string[] = [];
    printKeyValue(
      [
        ["k1", "v1"],
        ["longerKey", "v2"],
        ["skipped", undefined],
        ["also", null],
      ],
      (s) => out.push(s),
    );
    expect(out.length).toBe(2);
    expect(out[0]).toContain("k1");
    expect(out[0]).toContain("v1");
    // Second line's key column padded to longerKey width.
    expect(out[1]?.startsWith("longerKey")).toBe(true);
  });
  test("printTable emits header + separator + rows", () => {
    const out: string[] = [];
    printTable(["a", "b"], [["1", "22"], ["3333", "4"]], (s) => out.push(s));
    expect(out.length).toBe(4);
    expect(out[0]).toContain("a");
    expect(out[0]).toContain("b");
    expect(out[1]).toContain("-");
  });
});
