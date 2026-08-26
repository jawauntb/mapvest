import { describe, expect, test } from "bun:test";

import { parsePushPrefs, parsePushPrefsRead } from "./prefsResponse";

describe("push preference response validation", () => {
  test("rejects a GET response without the complete prefs envelope", () => {
    expect(() => parsePushPrefsRead({ prefs: {} })).toThrow(
      "Malformed notification preferences response",
    );
  });

  test("rejects a POST response with malformed preference values", () => {
    expect(() => parsePushPrefs({ find_evolution: "yes" })).toThrow(
      "Malformed notification preferences response",
    );
  });
});
