import { describe, expect, test } from "bun:test";
import { main } from "../src/index.js";

describe("mapvest main dispatcher", () => {
  test("prints help and exits 2 when called with no args", async () => {
    const out: string[] = [];
    const code = await main([], (s) => out.push(s));
    expect(code).toBe(2);
    expect(out.join("\n")).toContain("Usage:");
    expect(out.join("\n")).toContain("mapvest identify");
  });

  test("prints help and exits 0 when --help is passed", async () => {
    const out: string[] = [];
    const code = await main(["--help"], (s) => out.push(s));
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Usage:");
  });

  test("prints resolved API url via --api-url", async () => {
    const out: string[] = [];
    const code = await main(["--api-url"], (s) => out.push(s), {
      MAPVEST_API_URL: "http://x/",
    } as NodeJS.ProcessEnv);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("http://x");
  });

  test("returns 2 for unknown commands", async () => {
    const out: string[] = [];
    const code = await main(["frobnicate"], (s) => out.push(s));
    expect(code).toBe(2);
    expect(out.join("\n")).toContain("unknown command");
  });

  test("prints version via --version", async () => {
    const out: string[] = [];
    const code = await main(["--version"], (s) => out.push(s));
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("mapvest");
  });
});
