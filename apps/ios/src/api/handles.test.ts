import { describe, expect, test } from "bun:test";
import { HANDLE_FORMAT, RenameHandleResponse } from "./handles";

describe("HANDLE_FORMAT", () => {
  test.each([
    ["finder-1a2b3c4d", true],
    ["abc", true],
    ["a".repeat(20), true],
    ["a-b-c", true],
    ["ab", false], // too short
    ["a".repeat(21), false], // too long
    ["Finder-1A2B", false], // uppercase
    ["has space", false],
    ["under_score", false],
    ["", false],
  ])("%s -> %s", (candidate, expected) => {
    expect(HANDLE_FORMAT.test(candidate)).toBe(expected);
  });
});

describe("RenameHandleResponse schema parse", () => {
  test("parses a well-formed success response", () => {
    const parsed = RenameHandleResponse.parse({ ok: true, handle: "finder-1a2b3c4d" });
    expect(parsed).toEqual({ ok: true, handle: "finder-1a2b3c4d" });
  });

  test("rejects a response missing handle", () => {
    expect(() => RenameHandleResponse.parse({ ok: true })).toThrow();
  });

  test("rejects a response where ok is not literally true", () => {
    expect(() => RenameHandleResponse.parse({ ok: false, handle: "finder-1a2b3c4d" })).toThrow();
  });

  test("rejects a non-object payload", () => {
    expect(() => RenameHandleResponse.parse(null)).toThrow();
    expect(() => RenameHandleResponse.parse("finder-1a2b3c4d")).toThrow();
  });
});
