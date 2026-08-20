import { describe, expect, test } from "bun:test";
import { environmentExaQueries, resolveSector } from "../src/environmentBrief.js";

describe("environmentExaQueries", () => {
  test("names the sector and a two-year window", () => {
    const queries = environmentExaQueries(
      "Information Technology",
      new Date("2026-08-20T00:00:00Z"),
    );
    expect(queries).toHaveLength(2);
    expect(queries.map((q) => q.bucket)).toEqual(["policy", "demand"]);
    for (const q of queries) {
      expect(q.query).toContain("Information Technology");
      expect(q.query).toContain("2025");
      expect(q.query).toContain("2026");
    }
  });
});

describe("resolveSector", () => {
  test("canonicalizes a free-form label and rejects junk", () => {
    expect(resolveSector("information technology")).toBe("Information Technology");
    expect(resolveSector("not-a-gics-sector")).toBeNull();
  });
});
