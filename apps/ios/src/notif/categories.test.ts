import { describe, expect, test } from "bun:test";
import { PUSH_CATEGORY_DEFINITIONS } from "./categories";
import { PUSH_ACTION_IDS } from "./delivery";

describe("notification action categories", () => {
  test("actions only open foreground navigation and always offer settings", () => {
    for (const category of PUSH_CATEGORY_DEFINITIONS) {
      expect(category.actions.every((action) => action.options.opensAppToForeground)).toBe(true);
      expect(
        category.actions.some((action) => action.identifier === PUSH_ACTION_IDS.settings),
      ).toBe(true);
    }
  });
});
