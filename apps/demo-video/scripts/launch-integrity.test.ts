import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMPOSITION_VARIANTS, FPS, sceneById } from "../src/storyboard";
import {
  type LaunchInputSnapshot,
  type LaunchRenderDigest,
  type PreparedMediaMetadata,
  assertRenderManifestCurrent,
  createRenderManifest,
  sha256File,
  validatePreparedLaunchAssets,
} from "./launch-integrity";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

const preparedScenes = ["map", "local-brief", "universe", "daily"] as const;

const createCaptureFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "mapvest-launch-integrity-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "public", "provenance"), { recursive: true });
  const metadata = new Map<string, PreparedMediaMetadata>();
  const outputs = [] as Array<Record<string, unknown>>;

  for (const scene of preparedScenes) {
    const storyboardScene = sceneById(scene);
    const file = storyboardScene.asset;
    const path = join(root, "public", file);
    const durationSeconds = storyboardScene.durationInFrames / FPS;
    await Bun.write(path, `prepared ${scene}`);
    const media = {
      codecName: "h264",
      width: 1206,
      height: 2622,
      pixelFormat: "yuv420p",
      frameRate: `${FPS}/1`,
      durationSeconds,
    } satisfies PreparedMediaMetadata;
    metadata.set(path, media);
    outputs.push({
      scene,
      file,
      sha256: await sha256File(path),
      codec_name: media.codecName,
      width: media.width,
      height: media.height,
      pix_fmt: media.pixelFormat,
      r_frame_rate: media.frameRate,
      durationSeconds,
    });
  }

  const provenancePath = join(root, "public", "provenance", "launch-captures.json");
  const provenance = {
    simulatorViewport: { width: 1206, height: 2622, fps: FPS },
    outputs,
  };
  await Bun.write(provenancePath, JSON.stringify(provenance));
  const probe = (path: string) => {
    const result = metadata.get(path);
    if (!result) throw new Error(`Missing fixture probe for ${path}`);
    return result;
  };

  return { root, metadata, outputs, probe, provenance, provenancePath };
};

const digest = (path: string, character: string) => ({
  path,
  sha256: character.repeat(64),
});

const createInputSnapshot = (): LaunchInputSnapshot => ({
  storyboard: {
    visualTimeline: "mapvest-launch-v1",
    fps: FPS,
    totalDurationInFrames: 1_755,
    sha256: "a".repeat(64),
  },
  compositionSources: [digest("src/MapvestTweet.tsx", "b")],
  publicAssets: [digest("map-nearby.mp4", "c")],
  captureProvenance: digest("public/provenance/launch-captures.json", "d"),
  soundtrack: {
    asset: digest("public/music/mapvest-launch.mp3", "e"),
    provenance: digest("public/music/mapvest-launch.provenance.json", "f"),
    prompt: digest("music/mapvest-launch.prompt.txt", "1"),
  },
});

const createRenderDigests = (): LaunchRenderDigest[] =>
  COMPOSITION_VARIANTS.map(({ id, outputFilename }, index) => ({
    id,
    file: outputFilename,
    sha256: String(index + 2).repeat(64),
  }));

describe("prepared launch asset integrity", () => {
  test("accepts the complete hashed scene set with enough media for each scene", async () => {
    const fixture = await createCaptureFixture();

    await expect(validatePreparedLaunchAssets(fixture.root, fixture.probe)).resolves.toHaveLength(
      4,
    );
  });

  test("rejects provenance with an incomplete prepared scene set", async () => {
    const fixture = await createCaptureFixture();
    fixture.provenance.outputs.pop();
    await Bun.write(fixture.provenancePath, JSON.stringify(fixture.provenance));

    await expect(validatePreparedLaunchAssets(fixture.root, fixture.probe)).rejects.toThrow(
      "scene set is incomplete",
    );
  });

  test("rejects a prepared asset whose bytes drift from provenance", async () => {
    const fixture = await createCaptureFixture();
    await Bun.write(join(fixture.root, "public", sceneById("map").asset), "changed bytes");

    await expect(validatePreparedLaunchAssets(fixture.root, fixture.probe)).rejects.toThrow(
      "asset hash drifted",
    );
  });

  test("rejects a prepared asset shorter than its current storyboard scene", async () => {
    const fixture = await createCaptureFixture();
    const dailyPath = join(fixture.root, "public", sceneById("daily").asset);
    const daily = fixture.metadata.get(dailyPath)!;
    fixture.metadata.set(dailyPath, {
      ...daily,
      durationSeconds: sceneById("daily").durationInFrames / FPS - 0.02,
    });

    await expect(validatePreparedLaunchAssets(fixture.root, fixture.probe)).rejects.toThrow(
      "asset is too short",
    );
  });
});

describe("completed launch render manifest", () => {
  test("accepts one complete four-variant set bound to current inputs and output hashes", () => {
    const inputs = createInputSnapshot();
    const renders = createRenderDigests();
    const manifest = createRenderManifest("run-1", "2026-08-28T12:00:00.000Z", inputs, renders);

    expect(assertRenderManifestCurrent(manifest, inputs, renders).runId).toBe("run-1");
  });

  test("rejects an incomplete four-variant manifest", () => {
    const inputs = createInputSnapshot();
    const renders = createRenderDigests();
    const manifest = createRenderManifest(
      "run-1",
      "2026-08-28T12:00:00.000Z",
      inputs,
      renders.slice(0, -1),
    );

    expect(() => assertRenderManifestCurrent(manifest, inputs, renders)).toThrow(
      "complete four-variant render set",
    );
  });

  test("rejects a manifest from stale storyboard or composition inputs", () => {
    const inputs = createInputSnapshot();
    const renders = createRenderDigests();
    const staleInputs = {
      ...inputs,
      storyboard: { ...inputs.storyboard, sha256: "9".repeat(64) },
    };
    const manifest = createRenderManifest(
      "run-1",
      "2026-08-28T12:00:00.000Z",
      staleInputs,
      renders,
    );

    expect(() => assertRenderManifestCurrent(manifest, inputs, renders)).toThrow(
      "manifest is stale",
    );
  });

  test("rejects a completed manifest when an output hash changes", () => {
    const inputs = createInputSnapshot();
    const renders = createRenderDigests();
    const manifest = createRenderManifest("run-1", "2026-08-28T12:00:00.000Z", inputs, renders);
    const changed = renders.map((render, index) =>
      index === 0 ? { ...render, sha256: "8".repeat(64) } : render,
    );

    expect(() => assertRenderManifestCurrent(manifest, inputs, changed)).toThrow(
      "output hash drifted",
    );
  });
});
