import { describe, expect, test } from "bun:test";
import {
  TARGET_DURATION_SECONDS,
  assertAudioPacketCoverage,
  runBoundedMediaCommand,
} from "./music-alternative-media.js";

describe("music alternative media isolation", () => {
  test("does not expose provider credentials to media subprocesses", async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "media-child-must-not-see-this";
    try {
      await expect(
        runBoundedMediaCommand(["/bin/sh", "-c", 'test -z "${GEMINI_API_KEY:-}"'], {
          timeoutMs: 1_000,
        }),
      ).resolves.toBe("");
    } finally {
      if (originalKey === undefined) Reflect.deleteProperty(process.env, "GEMINI_API_KEY");
      else process.env.GEMINI_API_KEY = originalKey;
    }
  });
});

describe("audio packet coverage", () => {
  test("rejects an interior packet gap despite valid endpoints", () => {
    expect(() =>
      assertAudioPacketCoverage(
        {
          packetCount: 3,
          sha256: "fixture",
          startTimeSeconds: 0,
          endTimeSeconds: TARGET_DURATION_SECONDS,
          maxUncoveredGapSeconds: 0.5,
        },
        "fixture audio",
      ),
    ).toThrow("complete 58.5s timeline");
  });
});
