import { describe, expect, test } from "bun:test";
import { ApiError, shouldRetryQuery } from "./errors.ts";

describe("shouldRetryQuery", () => {
  test("does not retry rate limits or expired sessions", () => {
    expect(shouldRetryQuery(0, new ApiError(429, "rate limit exceeded"))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(401, "unauthorized"))).toBe(false);
  });

  test("retries other failures once", () => {
    expect(shouldRetryQuery(0, new ApiError(502, "quote unavailable"))).toBe(true);
    expect(shouldRetryQuery(1, new ApiError(502, "quote unavailable"))).toBe(false);
    expect(shouldRetryQuery(0, new Error("network"))).toBe(true);
  });
});
