import { describe, expect, test } from "bun:test";
import { ApiError, formatResearchError, shouldRetryQuery } from "./errors";

describe("formatResearchError", () => {
  test("never exposes machine codes from research responses", () => {
    expect(formatResearchError(new ApiError(502, "research_upstream_403"))).toBe(
      "Research access is temporarily unavailable. Try again shortly.",
    );
    expect(
      formatResearchError("UPSTREAM_AUTH_FAILED", "Research stopped before it finished."),
    ).toBe("Research access is temporarily unavailable. Try again shortly.");
    expect(formatResearchError("Research failed (research_upstream_403).", "Try again.")).toBe(
      "Research access is temporarily unavailable. Try again shortly.",
    );
    expect(
      formatResearchError("research_upstream_502", "Research stopped before it finished."),
    ).toBe("Research is temporarily unavailable. Try again.");
    expect(
      formatResearchError("iteration_limit_exhausted", "Research hit a limit. Try again."),
    ).toBe("Research hit a limit. Try again.");
    expect(formatResearchError("invalid-request", "Research couldn’t start. Try again.")).toBe(
      "Research couldn’t start. Try again.",
    );
    expect(formatResearchError("provider.failure-v2", "Research couldn’t start. Try again.")).toBe(
      "Research couldn’t start. Try again.",
    );
    expect(formatResearchError("x.y.z", "Research couldn’t start. Try again.")).toBe(
      "Research couldn’t start. Try again.",
    );
  });

  test("uses concise retry copy for server and network failures", () => {
    expect(formatResearchError(new ApiError(503, "service unavailable"))).toBe(
      "Research is temporarily unavailable. Try again.",
    );
    expect(formatResearchError(new TypeError("Network request failed"))).toBe(
      "Couldn’t connect to research. Check your connection and try again.",
    );
  });

  test("preserves intentionally user-facing messages", () => {
    const message = "This saved research is no longer available. Send again to start a new one.";
    expect(formatResearchError(new ApiError(404, message))).toBe(message);
    expect(formatResearchError("Access to this saved research is no longer available.")).toBe(
      "Access to this saved research is no longer available.",
    );
    expect(formatResearchError("Research hit a limit — we wrote a shorter brief instead.")).toBe(
      "Research hit a limit — we wrote a shorter brief instead.",
    );
  });
});

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
