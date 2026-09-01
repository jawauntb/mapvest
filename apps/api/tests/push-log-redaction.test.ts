import { describe, expect, test } from "bun:test";
import { redactPushLogLine } from "../src/middleware/pushLogRedaction.js";

describe("push request log redaction", () => {
  test("redacts path and query installation identifiers", () => {
    expect(redactPushLogLine("DELETE /v1/push/token/push_secret 204 3ms")).toBe(
      "DELETE /v1/push/token/[redacted] 204 3ms",
    );
    expect(redactPushLogLine("GET /v1/push/prefs?tokenId=push_secret&other=safe 200 2ms")).toBe(
      "GET /v1/push/prefs?tokenId=[redacted]&other=safe 200 2ms",
    );
  });
});
