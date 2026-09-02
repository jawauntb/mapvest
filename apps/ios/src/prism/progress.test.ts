import { describe, expect, test } from "bun:test";
import { PRISM_BUILD_STAGES, buildStage, fmtElapsed, stageIndex } from "./progress";

describe("buildStage", () => {
  test("starts on the universe stage and walks forward with elapsed time", () => {
    expect(buildStage(0).key).toBe("universe");
    expect(buildStage(25_000).key).toBe("macro");
    expect(buildStage(60_000).key).toBe("quant");
    expect(buildStage(90_000).key).toBe("filings");
    expect(buildStage(120_000).key).toBe("scenarios");
    expect(buildStage(150_000).key).toBe("memo");
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
    expect(buildStage(Number.NaN).key).toBe("universe");
    expect(buildStage(-5).progress).toBe(0);
  });

  test("every stage carries copy the screen can render", () => {
    expect(PRISM_BUILD_STAGES.length).toBe(7);
    for (const stage of PRISM_BUILD_STAGES) {
      expect(stage.label.length).toBeGreaterThan(0);
      expect(stage.detail.length).toBeGreaterThan(0);
    }
    expect(stageIndex(0)).toBe(0);
    expect(stageIndex(150_000)).toBe(5);
  });
});

test("fmtElapsed renders a clock", () => {
  expect(fmtElapsed(0)).toBe("0:00");
  expect(fmtElapsed(74_000)).toBe("1:14");
  expect(fmtElapsed(600_000)).toBe("10:00");
  expect(fmtElapsed(Number.NaN)).toBe("0:00");
});
