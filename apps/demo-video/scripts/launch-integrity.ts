import { createHash } from "node:crypto";
import { isAbsolute, join, normalize, sep } from "node:path";
import {
  COMPOSITION_VARIANTS,
  FPS,
  LAUNCH_MUSIC_ASSET,
  LAUNCH_STORYBOARD,
  type LaunchSceneId,
  TOTAL_DURATION_IN_FRAMES,
  VISUAL_TIMELINE_ID,
  sceneById,
} from "../src/storyboard";

export const RENDER_MANIFEST_FILENAME = "launch-render-manifest.json";
export const RENDER_MANIFEST_VERSION = 1;

const CAPTURE_PROVENANCE_PATH = "public/provenance/launch-captures.json";
const MUSIC_PROVENANCE_PATH = "public/music/mapvest-launch.provenance.json";
const PREPARED_SCENE_IDS = ["map", "local-brief", "universe", "daily"] as const;
const COMPOSITION_SOURCE_PATHS = [
  "src/index.ts",
  "src/MapvestTweet.tsx",
  "src/Root.tsx",
  "src/storyboard.ts",
  "remotion.config.ts",
  "package.json",
] as const;
const EXTRA_PUBLIC_ASSET_PATHS = [
  "provenance/macbook-identify.json",
  "research-start.png",
  "research-running.png",
  "research-complete.png",
] as const;

type FileDigest = {
  path: string;
  sha256: string;
};

export type LaunchInputSnapshot = {
  storyboard: {
    visualTimeline: typeof VISUAL_TIMELINE_ID;
    fps: number;
    totalDurationInFrames: number;
    sha256: string;
  };
  compositionSources: FileDigest[];
  publicAssets: FileDigest[];
  captureProvenance: FileDigest;
  soundtrack: {
    asset: FileDigest;
    provenance: FileDigest;
    prompt: FileDigest;
  };
};

export type LaunchRenderDigest = {
  id: string;
  file: string;
  sha256: string;
};

export type LaunchRenderManifest = {
  schemaVersion: typeof RENDER_MANIFEST_VERSION;
  runId: string;
  completedAt: string;
  inputs: LaunchInputSnapshot;
  renders: LaunchRenderDigest[];
};

export type PreparedMediaMetadata = {
  codecName?: string;
  width?: number;
  height?: number;
  pixelFormat?: string;
  frameRate?: string;
  durationSeconds: number;
};

type CaptureOutput = {
  scene: string;
  file: string;
  sha256: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  durationSeconds?: number;
};

type CaptureProvenance = {
  simulatorViewport?: { width?: number; height?: number; fps?: number };
  outputs?: CaptureOutput[];
};

type MusicProvenance = {
  promptPath?: string;
  promptSha256?: string;
  outputSha256?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
};

export const stableStringify = (value: unknown) => JSON.stringify(stableValue(value));

export const sha256Text = (value: string) => createHash("sha256").update(value).digest("hex");

export const sha256File = async (path: string) =>
  createHash("sha256")
    .update(new Uint8Array(await Bun.file(path).arrayBuffer()))
    .digest("hex");

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function assertSafeRelativePath(path: unknown, label: string): asserts path is string {
  if (typeof path !== "string" || path.length === 0 || isAbsolute(path)) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  const normalized = normalize(path);
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new Error(`${label} cannot leave the demo-video directory.`);
  }
}

const parseJsonFile = async (path: string) => {
  try {
    return JSON.parse(await Bun.file(path).text()) as unknown;
  } catch (error) {
    throw new Error(
      `Could not read valid JSON from ${path}: ${error instanceof Error ? error.message : error}`,
    );
  }
};

const defaultPreparedMediaProbe = (path: string): PreparedMediaMetadata => {
  const result = Bun.spawnSync(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,pix_fmt,r_frame_rate:format=duration",
      "-of",
      "json",
      path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    throw new Error(`ffprobe failed for ${path}${detail ? `: ${detail}` : ""}`);
  }
  const parsed = JSON.parse(result.stdout.toString()) as {
    streams?: Array<{
      codec_name?: string;
      width?: number;
      height?: number;
      pix_fmt?: string;
      r_frame_rate?: string;
    }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0];
  return {
    codecName: stream?.codec_name,
    width: stream?.width,
    height: stream?.height,
    pixelFormat: stream?.pix_fmt,
    frameRate: stream?.r_frame_rate,
    durationSeconds: Number(parsed.format?.duration),
  };
};

export const validatePreparedLaunchAssets = async (
  root: string,
  probe: (path: string) => PreparedMediaMetadata = defaultPreparedMediaProbe,
) => {
  const provenancePath = join(root, CAPTURE_PROVENANCE_PATH);
  const parsed = await parseJsonFile(provenancePath);
  if (!isRecord(parsed) || !Array.isArray(parsed.outputs) || !isRecord(parsed.simulatorViewport)) {
    throw new Error("Launch capture provenance is missing outputs or simulatorViewport.");
  }
  const provenance = parsed as CaptureProvenance;
  const expectedScenes = [...PREPARED_SCENE_IDS].sort();
  const outputs = provenance.outputs ?? [];
  const actualScenes = outputs.map(({ scene }) => scene).sort();
  if (stableStringify(actualScenes) !== stableStringify(expectedScenes)) {
    throw new Error(
      `Prepared launch scene set is incomplete or unexpected: expected ${expectedScenes.join(", ")}; received ${actualScenes.join(", ") || "none"}.`,
    );
  }

  const viewport = provenance.simulatorViewport;
  if (
    !viewport ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.fps !== FPS
  ) {
    throw new Error("Launch capture provenance has an invalid simulator viewport contract.");
  }

  const validated = [] as Array<{
    scene: LaunchSceneId;
    file: string;
    sha256: string;
    durationSeconds: number;
  }>;
  for (const scene of PREPARED_SCENE_IDS) {
    const output = outputs.find((candidate) => candidate.scene === scene);
    if (!output) throw new Error(`Prepared launch provenance is missing ${scene}.`);
    const expectedFile = sceneById(scene).asset;
    if (output.file !== expectedFile) {
      throw new Error(
        `Prepared ${scene} file drifted: expected ${expectedFile}; received ${output.file}.`,
      );
    }
    assertSha256(output.sha256, `Prepared ${scene} sha256`);
    const assetPath = join(root, "public", expectedFile);
    if (!(await Bun.file(assetPath).exists())) {
      throw new Error(`Prepared ${scene} asset is missing: ${assetPath}`);
    }
    const actualSha256 = await sha256File(assetPath);
    if (actualSha256 !== output.sha256) {
      throw new Error(
        `Prepared ${scene} asset hash drifted: expected ${output.sha256}; received ${actualSha256}.`,
      );
    }

    const metadata = probe(assetPath);
    const requiredDuration = sceneById(scene).durationInFrames / FPS;
    if (!Number.isFinite(metadata.durationSeconds)) {
      throw new Error(`Prepared ${scene} asset has no finite duration.`);
    }
    if (metadata.durationSeconds + 0.01 < requiredDuration) {
      throw new Error(
        `Prepared ${scene} asset is too short: ${metadata.durationSeconds.toFixed(3)}s for a ${requiredDuration.toFixed(3)}s scene.`,
      );
    }
    if (
      typeof output.durationSeconds !== "number" ||
      Math.abs(output.durationSeconds - metadata.durationSeconds) > 0.01
    ) {
      throw new Error(`Prepared ${scene} duration drifted from capture provenance.`);
    }
    if (
      metadata.codecName !== "h264" ||
      metadata.width !== viewport.width ||
      metadata.height !== viewport.height ||
      metadata.pixelFormat !== "yuv420p" ||
      metadata.frameRate !== `${FPS}/1`
    ) {
      throw new Error(`Prepared ${scene} asset failed its committed media contract.`);
    }
    if (
      output.codec_name !== metadata.codecName ||
      output.width !== metadata.width ||
      output.height !== metadata.height ||
      output.pix_fmt !== metadata.pixelFormat ||
      output.r_frame_rate !== metadata.frameRate
    ) {
      throw new Error(`Prepared ${scene} media metadata drifted from capture provenance.`);
    }
    validated.push({
      scene,
      file: expectedFile,
      sha256: actualSha256,
      durationSeconds: metadata.durationSeconds,
    });
  }
  return validated;
};

const digest = async (root: string, path: string): Promise<FileDigest> => {
  const absolutePath = join(root, path);
  if (!(await Bun.file(absolutePath).exists())) throw new Error(`Launch input is missing: ${path}`);
  return { path, sha256: await sha256File(absolutePath) };
};

const digestMany = async (root: string, paths: readonly string[]) =>
  Promise.all([...paths].sort().map((path) => digest(root, path)));

export const collectLaunchInputSnapshot = async (root: string): Promise<LaunchInputSnapshot> => {
  const storyboardPayload = {
    fps: FPS,
    musicAsset: LAUNCH_MUSIC_ASSET,
    scenes: LAUNCH_STORYBOARD,
    totalDurationInFrames: TOTAL_DURATION_IN_FRAMES,
    variants: COMPOSITION_VARIANTS,
    visualTimeline: VISUAL_TIMELINE_ID,
  };
  const referencedPublicAssets = [
    ...new Set([...LAUNCH_STORYBOARD.map(({ asset }) => asset), ...EXTRA_PUBLIC_ASSET_PATHS]),
  ];

  const soundtrackAssetPath = join("public", LAUNCH_MUSIC_ASSET);
  const soundtrackProvenance = await parseJsonFile(join(root, MUSIC_PROVENANCE_PATH));
  if (!isRecord(soundtrackProvenance)) {
    throw new Error("Accepted soundtrack provenance must be a JSON object.");
  }
  const music = soundtrackProvenance as MusicProvenance;
  assertSafeRelativePath(music.promptPath, "Soundtrack promptPath");
  assertSha256(music.promptSha256, "Soundtrack promptSha256");
  assertSha256(music.outputSha256, "Soundtrack outputSha256");
  const soundtrackAsset = await digest(root, soundtrackAssetPath);
  if (soundtrackAsset.sha256 !== music.outputSha256) {
    throw new Error("Accepted soundtrack hash drifted from its provenance.");
  }
  const prompt = await digest(root, music.promptPath);
  const normalizedPromptSha256 = sha256Text(
    (await Bun.file(join(root, music.promptPath)).text()).trim(),
  );
  if (normalizedPromptSha256 !== music.promptSha256) {
    throw new Error("Accepted soundtrack prompt hash drifted from its provenance.");
  }

  return {
    storyboard: {
      visualTimeline: VISUAL_TIMELINE_ID,
      fps: FPS,
      totalDurationInFrames: TOTAL_DURATION_IN_FRAMES,
      sha256: sha256Text(stableStringify(storyboardPayload)),
    },
    compositionSources: await digestMany(root, COMPOSITION_SOURCE_PATHS),
    publicAssets: await digestMany(
      join(root, "public"),
      referencedPublicAssets.filter((path) => path !== LAUNCH_MUSIC_ASSET),
    ),
    captureProvenance: await digest(root, CAPTURE_PROVENANCE_PATH),
    soundtrack: {
      asset: soundtrackAsset,
      provenance: await digest(root, MUSIC_PROVENANCE_PATH),
      prompt,
    },
  };
};

export const createRenderManifest = (
  runId: string,
  completedAt: string,
  inputs: LaunchInputSnapshot,
  renders: LaunchRenderDigest[],
): LaunchRenderManifest => ({
  schemaVersion: RENDER_MANIFEST_VERSION,
  runId,
  completedAt,
  inputs,
  renders,
});

const parseManifest = (value: unknown): LaunchRenderManifest => {
  if (!isRecord(value)) throw new Error("Launch render manifest must be a JSON object.");
  if (value.schemaVersion !== RENDER_MANIFEST_VERSION) {
    throw new Error(`Unsupported launch render manifest schema: ${value.schemaVersion}.`);
  }
  if (typeof value.runId !== "string" || value.runId.length === 0) {
    throw new Error("Launch render manifest has no runId.");
  }
  if (typeof value.completedAt !== "string" || !Number.isFinite(Date.parse(value.completedAt))) {
    throw new Error("Launch render manifest has no valid completion timestamp.");
  }
  if (!isRecord(value.inputs) || !Array.isArray(value.renders)) {
    throw new Error("Launch render manifest is incomplete.");
  }
  return value as LaunchRenderManifest;
};

export const assertRenderManifestCurrent = (
  rawManifest: unknown,
  currentInputs: LaunchInputSnapshot,
  actualRenders: LaunchRenderDigest[],
) => {
  const manifest = parseManifest(rawManifest);
  if (stableStringify(manifest.inputs) !== stableStringify(currentInputs)) {
    throw new Error(
      "Launch render manifest is stale: storyboard, composition source, soundtrack, capture provenance, or a referenced public asset changed.",
    );
  }

  const expected = COMPOSITION_VARIANTS.map(({ id, outputFilename }) => ({
    id,
    file: outputFilename,
  }));
  const declared = manifest.renders.map(({ id, file }) => ({ id, file }));
  if (stableStringify(declared) !== stableStringify(expected)) {
    throw new Error(
      "Launch render manifest does not declare the complete four-variant render set.",
    );
  }
  if (actualRenders.length !== expected.length) {
    throw new Error("Current output set does not contain all four launch renders.");
  }

  for (const [index, expectedRender] of expected.entries()) {
    const declaredRender = manifest.renders[index];
    const actualRender = actualRenders[index];
    if (!declaredRender || !actualRender) {
      throw new Error(`Launch render manifest is incomplete at ${expectedRender.id}.`);
    }
    assertSha256(declaredRender.sha256, `${expectedRender.id} manifest hash`);
    assertSha256(actualRender.sha256, `${expectedRender.id} output hash`);
    if (
      actualRender.id !== expectedRender.id ||
      actualRender.file !== expectedRender.file ||
      actualRender.sha256 !== declaredRender.sha256
    ) {
      throw new Error(`Launch output hash drifted from the completed run: ${expectedRender.file}.`);
    }
  }
  return manifest;
};

export const assertLaunchInputsUnchanged = (
  before: LaunchInputSnapshot,
  after: LaunchInputSnapshot,
) => {
  if (stableStringify(before) !== stableStringify(after)) {
    throw new Error("Launch inputs changed while rendering; the staged set will not be published.");
  }
};
