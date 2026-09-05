import { describe, expect, test } from "bun:test";
import { SITUATE_BUILD_STAGES, buildStage, fmtElapsed, stageIndex } from "./progress";

describe("buildStage", () => {
  test("starts on the panel stage and walks forward with elapsed time", () => {
    expect(buildStage(0).key).toBe("panel");
    expect(buildStage(25_000).key).toBe("exposure");
    expect(buildStage(50_000).key).toBe("base_rates");
    expect(buildStage(75_000).key).toBe("implied");
    expect(buildStage(105_000).key).toBe("business");
    expect(buildStage(135_000).key).toBe("stack");
    expect(buildStage(155_000).key).toBe("memo");
    expect(buildStage(600_000).key).toBe("overtime");
  });

  test("never goes backwards and never claims to be finished", () => {
    let last = -1;
    for (let ms = 0; ms <= 400_000; ms += 5_000) {
      const p = buildStage(ms).progress;
      expect(p).toBeGreaterThanOrEqual(last);
      expect(p).toBeLessThanOrEqual(0.96);
      last = p;
    }
  });

  test("nonsense elapsed values fall back to the first stage", () => {
    expect(buildStage(Number.NaN).key).toBe("panel");
    expect(buildStage(-5).progress).toBe(0);
  });

  test("every stage carries copy the screen can render", () => {
    expect(SITUATE_BUILD_STAGES.length).toBe(8);
    for (const stage of SITUATE_BUILD_STAGES) {
      expect(stage.label.length).toBeGreaterThan(0);
      expect(stage.detail.length).toBeGreaterThan(0);
    }
    expect(stageIndex(0)).toBe(0);
    expect(stageIndex(155_000)).toBe(6);
  });
});

test("fmtElapsed renders a clock", () => {
  expect(fmtElapsed(0)).toBe("0:00");
  expect(fmtElapsed(74_000)).toBe("1:14");
  expect(fmtElapsed(600_000)).toBe("10:00");
  expect(fmtElapsed(Number.NaN)).toBe("0:00");
});
