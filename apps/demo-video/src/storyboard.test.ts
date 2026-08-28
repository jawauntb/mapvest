import { describe, expect, test } from "bun:test";
import {
  COMPOSITION_VARIANTS,
  FPS,
  LAUNCH_STORYBOARD,
  TOTAL_DURATION_IN_FRAMES,
  frameAt,
} from "./storyboard";

const EXPECTED_SCENE_IDS = [
  "hook",
  "map",
  "local-brief",
  "camera",
  "result",
  "universe",
  "detail",
  "research",
  "daily",
  "cta",
] as const;

describe("launch storyboard", () => {
  test("orders the complete launch story on a 58.5 second timeline", () => {
    expect(FPS).toBe(30);
    expect(LAUNCH_STORYBOARD.map(({ id }) => id)).toEqual([...EXPECTED_SCENE_IDS]);
    expect(TOTAL_DURATION_IN_FRAMES).toBe(frameAt(58.5));
    expect(TOTAL_DURATION_IN_FRAMES).toBe(1_755);
  });

  test("keeps every scene in bounds with only intentional transition overlaps", () => {
    for (const [index, scene] of LAUNCH_STORYBOARD.entries()) {
      expect(scene.startFrame).toBeGreaterThanOrEqual(0);
      expect(scene.durationInFrames).toBeGreaterThan(0);
      expect(scene.endFrame).toBe(scene.startFrame + scene.durationInFrames);
      expect(scene.endFrame).toBeLessThanOrEqual(TOTAL_DURATION_IN_FRAMES);

      const next = LAUNCH_STORYBOARD[index + 1];
      if (next) {
        expect(next.startFrame).toBeGreaterThan(scene.startFrame);
        expect(next.startFrame).toBeLessThanOrEqual(scene.endFrame);
        expect(scene.endFrame - next.startFrame).toBeLessThanOrEqual(frameAt(0.6));
      }
    }

    expect(LAUNCH_STORYBOARD.at(-1)?.endFrame).toBe(TOTAL_DURATION_IN_FRAMES);
  });

  test("defines four unique delivery variants over one visual timeline", () => {
    expect(COMPOSITION_VARIANTS).toHaveLength(4);
    expect(new Set(COMPOSITION_VARIANTS.map(({ id }) => id)).size).toBe(4);
    expect(new Set(COMPOSITION_VARIANTS.map(({ outputFilename }) => outputFilename)).size).toBe(4);
    expect(COMPOSITION_VARIANTS.map(({ id }) => id)).toEqual([
      "MapvestLaunchPortraitMusic",
      "MapvestLaunchPortraitSilent",
      "MapvestLaunchSquareMusic",
      "MapvestLaunchSquareSilent",
    ]);
    expect(new Set(COMPOSITION_VARIANTS.map(({ visualTimeline }) => visualTimeline))).toEqual(
      new Set(["mapvest-launch-v1"]),
    );
    expect(
      COMPOSITION_VARIANTS.map(({ format, soundtrack }) => `${format}:${soundtrack}`).sort(),
    ).toEqual(["portrait:music", "portrait:silent", "square:music", "square:silent"]);
  });
});
