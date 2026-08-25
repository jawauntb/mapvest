import { describe, expect, test } from "bun:test";

import { cameraResultCacheKey, cameraResultScope, canApplyCameraResult } from "./resultScope";

describe("Camera result ownership", () => {
  test("separates guest and signed-in result cache keys", () => {
    expect(cameraResultScope()).toBe("guest");
    expect(cameraResultCacheKey(cameraResultScope())).toEqual(["tab-state", "camera", "guest"]);
    expect(cameraResultCacheKey(cameraResultScope("account-a"))).toEqual([
      "tab-state",
      "camera",
      "user:account-a",
    ]);
  });

  test("rejects a guest or another account's late identify response", () => {
    expect(canApplyCameraResult("guest", "user:account-a")).toBe(false);
    expect(canApplyCameraResult("user:account-a", "user:account-b")).toBe(false);
    expect(canApplyCameraResult("user:account-a", "user:account-a")).toBe(true);
  });
});
