import { describe, expect, test } from "bun:test";
import { stripMdMarks } from "../src/lib/watchlist-brief.js";

describe("stripMdMarks", () => {
  test("unwraps a **headline**", () => {
    expect(stripMdMarks("**Tech Leadership Broadens as Gold and Industrials Fade**")).toBe(
      "Tech Leadership Broadens as Gold and Industrials Fade",
    );
  });
  test("leaves a clean headline alone", () => {
    expect(stripMdMarks("Tape leans risk-on")).toBe("Tape leans risk-on");
  });
});
