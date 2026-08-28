import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { FPS, type LaunchSceneId, sceneById } from "../src/storyboard";

const ROOT = join(import.meta.dir, "..");
const DEFAULT_PUBLIC_DIR = join(ROOT, "public");
const DEFAULT_CAPTURE_DIR = "/tmp/mapvest-launch-captures";

export const UNIVERSE_PRIVACY_MASK_Y = 1280;

export type PreparedAsset = {
  scene: LaunchSceneId;
  input: string;
  sourceKind: "video" | "screenshot";
  privacyTreatment: string;
};

export type VideoContract = {
  width: number;
  height: number;
  fps: number;
  universePrivacyMaskY: number;
};

export type PrepareLaunchAssetsOptions = {
  captureDir?: string;
  publicDir?: string;
  provenancePath?: string;
  force?: boolean;
  dryRun?: boolean;
  assets?: readonly PreparedAsset[];
  contract?: Partial<VideoContract>;
  durationSecondsForScene?: (scene: LaunchSceneId) => number;
  renamePath?: (from: string, to: string) => Promise<void>;
  now?: () => Date;
};

export type PrepareArguments = Pick<PrepareLaunchAssetsOptions, "captureDir" | "force" | "dryRun">;

type PreparedOutput = {
  scene: LaunchSceneId;
  file: string;
  sha256: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  pix_fmt?: string;
  durationSeconds: number;
  sourceKind: PreparedAsset["sourceKind"];
  privacyTreatment: string;
};

type Publication = {
  stagedPath: string;
  finalPath: string;
};

const DEFAULT_VIDEO_CONTRACT: VideoContract = {
  width: 1206,
  height: 2622,
  fps: FPS,
  universePrivacyMaskY: UNIVERSE_PRIVACY_MASK_Y,
};

export const DEFAULT_PREPARED_ASSETS = [
  {
    scene: "map",
    input: "map-raw.mp4",
    sourceKind: "video",
    privacyTreatment:
      "Manually framed at the public Flatiron test location; personal Finds were hidden before recording. No pixel mask is applied during preparation.",
  },
  {
    scene: "local-brief",
    input: "local-brief-raw.png",
    sourceKind: "screenshot",
    privacyTreatment:
      "A dev-only capture anchor isolates the sourced public-location brief. No pixel mask is applied during preparation.",
  },
  {
    scene: "universe",
    input: "universe-raw.png",
    sourceKind: "screenshot",
    privacyTreatment: `A physical pixel mask removes the source image below y=${UNIVERSE_PRIVACY_MASK_Y} before every encoded frame is written.`,
  },
  {
    scene: "daily",
    input: "daily-raw.png",
    sourceKind: "screenshot",
    privacyTreatment:
      "A dev-only capture anchor isolates the daily brief above watchlist names and controls. No pixel mask is applied during preparation.",
  },
] as const satisfies readonly PreparedAsset[];

const exists = async (path: string) => Bun.file(path).exists();

const sha256 = async (path: string) =>
  createHash("sha256")
    .update(new Uint8Array(await Bun.file(path).arrayBuffer()))
    .digest("hex");

const run = (command: string[]) => {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    throw new Error(`${command[0]} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.toString();
};

const defaultDurationSeconds = (scene: LaunchSceneId) => sceneById(scene).durationInFrames / FPS;

const probeDurationSeconds = (path: string) => {
  const raw = run([
    "ffprobe",
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]).trim();
  const duration = Number(raw);
  if (!Number.isFinite(duration)) {
    throw new Error(`Could not determine video duration: ${path}`);
  }
  return duration;
};

const probePreparedVideo = (
  path: string,
  expectedDurationSeconds: number,
  contract: VideoContract,
) => {
  const raw = run([
    "ffprobe",
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_name,width,height,r_frame_rate,pix_fmt:format=duration",
    "-of",
    "json",
    path,
  ]);
  const parsed = JSON.parse(raw) as {
    streams?: Array<{
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      pix_fmt?: string;
    }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0];
  const duration = Number(parsed.format?.duration);
  const durationDelta = Math.abs(duration - expectedDurationSeconds);
  const oneFrameSeconds = 1 / contract.fps;
  if (
    stream?.codec_name !== "h264" ||
    stream.width !== contract.width ||
    stream.height !== contract.height ||
    stream.r_frame_rate !== `${contract.fps}/1` ||
    stream.pix_fmt !== "yuv420p" ||
    !Number.isFinite(duration) ||
    durationDelta > oneFrameSeconds + 0.001
  ) {
    throw new Error(
      `Prepared clip failed its video contract: ${path} (expected ${expectedDurationSeconds.toFixed(3)}s within one frame, got ${Number.isFinite(duration) ? duration.toFixed(3) : "unknown"}s)`,
    );
  }
  return { ...stream, durationSeconds: Number(duration.toFixed(3)) };
};

const encodeAsset = (
  asset: PreparedAsset,
  inputPath: string,
  stagedPath: string,
  seconds: number,
  contract: VideoContract,
) => {
  const shared = [
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
  ];

  if (asset.sourceKind === "video") {
    const sourceDuration = probeDurationSeconds(inputPath);
    if (sourceDuration + 0.001 < seconds) {
      throw new Error(
        `Source video is shorter than its storyboard scene: ${inputPath} (${sourceDuration.toFixed(3)}s < ${seconds.toFixed(3)}s)`,
      );
    }
    run([
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-t",
      String(seconds),
      "-vf",
      `fps=${contract.fps},scale=${contract.width}:${contract.height}:flags=lanczos`,
      ...shared,
      stagedPath,
    ]);
    return;
  }

  const motionWidth = contract.width + 36;
  const motionHeight = contract.height + 78;
  const motion = `scale=${motionWidth}:${motionHeight}:flags=lanczos,crop=${contract.width}:${contract.height}:x='(in_w-out_w)/2':y='(in_h-out_h)*(t/${seconds})',fps=${contract.fps}`;
  const filter =
    asset.scene === "universe"
      ? `drawbox=x=0:y=${contract.universePrivacyMaskY}:w=iw:h=ih-${contract.universePrivacyMaskY}:color=0x080b0d:t=fill,${motion}`
      : motion;
  run([
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-loop",
    "1",
    "-framerate",
    String(contract.fps),
    "-i",
    inputPath,
    "-t",
    String(seconds),
    "-vf",
    filter,
    ...shared,
    stagedPath,
  ]);
};

const rollbackPublications = async (
  publications: Array<Publication & { originallyExisted: boolean; backupPath: string }>,
  renamePath: (from: string, to: string) => Promise<void>,
) => {
  const failures: string[] = [];
  for (const publication of [...publications].reverse()) {
    try {
      if (!publication.originallyExisted) {
        await rm(publication.finalPath, { force: true });
        continue;
      }
      if (await exists(publication.backupPath)) {
        await rm(publication.finalPath, { force: true });
        await renamePath(publication.backupPath, publication.finalPath);
      }
    } catch (error) {
      failures.push(
        `${publication.finalPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return failures;
};

const publishPreparedSet = async (
  publications: Publication[],
  publicDir: string,
  force: boolean,
  renamePath: (from: string, to: string) => Promise<void>,
) => {
  const backupDir = await mkdtemp(join(publicDir, ".launch-assets-backup-"));
  const states = await Promise.all(
    publications.map(async (publication, index) => ({
      ...publication,
      originallyExisted: await exists(publication.finalPath),
      backupPath: join(backupDir, `${index}-${basename(publication.finalPath)}`),
    })),
  );

  try {
    for (const state of states) {
      if (state.originallyExisted) {
        if (!force) throw new Error(`Output exists: ${state.finalPath}`);
        await renamePath(state.finalPath, state.backupPath);
      }
    }
    for (const state of states) {
      await mkdir(dirname(state.finalPath), { recursive: true });
      await renamePath(state.stagedPath, state.finalPath);
    }
  } catch (error) {
    const rollbackFailures = await rollbackPublications(states, renamePath);
    if (rollbackFailures.length > 0) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}. Rollback was incomplete; recoverable backups remain at ${backupDir}: ${rollbackFailures.join("; ")}`,
        { cause: error },
      );
    }
    await rm(backupDir, { recursive: true, force: true });
    throw error;
  }

  await rm(backupDir, { recursive: true, force: true });
};

export const parsePrepareArguments = (args: string[]): PrepareArguments => {
  const captureDirIndex = args.indexOf("--capture-dir");
  let captureDir = DEFAULT_CAPTURE_DIR;
  if (captureDirIndex >= 0) {
    const suppliedValue = args[captureDirIndex + 1];
    if (!suppliedValue || suppliedValue.startsWith("--")) {
      throw new Error("--capture-dir requires a value");
    }
    captureDir = suppliedValue;
  }
  return {
    captureDir,
    force: args.includes("--force"),
    dryRun: args.includes("--dry-run"),
  };
};

export const prepareLaunchAssets = async (options: PrepareLaunchAssetsOptions = {}) => {
  const captureDir = options.captureDir ?? DEFAULT_CAPTURE_DIR;
  const publicDir = options.publicDir ?? DEFAULT_PUBLIC_DIR;
  const provenancePath =
    options.provenancePath ?? join(publicDir, "provenance", "launch-captures.json");
  const force = options.force ?? false;
  const dryRun = options.dryRun ?? false;
  const assets = options.assets ?? DEFAULT_PREPARED_ASSETS;
  const contract = { ...DEFAULT_VIDEO_CONTRACT, ...options.contract };
  const durationSecondsForScene = options.durationSecondsForScene ?? defaultDurationSeconds;
  const renamePath = options.renamePath ?? rename;

  if (
    contract.width <= 0 ||
    contract.height <= 0 ||
    contract.fps <= 0 ||
    contract.universePrivacyMaskY < 0 ||
    contract.universePrivacyMaskY >= contract.height
  ) {
    throw new Error("Invalid prepared-video contract");
  }

  const missingInputs = [] as string[];
  for (const asset of assets) {
    const inputPath = join(captureDir, asset.input);
    if (!(await exists(inputPath))) missingInputs.push(inputPath);
  }
  if (missingInputs.length > 0) {
    throw new Error(
      `Missing raw capture inputs:\n${missingInputs.map((path) => `- ${path}`).join("\n")}`,
    );
  }

  const plan = {
    captureDir,
    publicDir,
    assets: assets.map((asset) => ({
      ...asset,
      durationSeconds: durationSecondsForScene(asset.scene),
    })),
  };
  if (dryRun) {
    return { dryRun: true as const, plan, outputs: [] as PreparedOutput[], provenancePath };
  }

  const finalPaths = [
    ...assets.map((asset) => join(publicDir, sceneById(asset.scene).asset)),
    provenancePath,
  ];
  if (!force) {
    const existingOutputs = [] as string[];
    for (const path of finalPaths) {
      if (await exists(path)) existingOutputs.push(path);
    }
    if (existingOutputs.length > 0) {
      throw new Error(
        `Outputs exist:\n${existingOutputs.map((path) => `- ${path}`).join("\n")}\nPass --force to replace prepared launch assets.`,
      );
    }
  }

  await mkdir(publicDir, { recursive: true });
  const stagingDir = await mkdtemp(join(publicDir, ".launch-assets-stage-"));
  const outputs: PreparedOutput[] = [];

  try {
    const publications: Publication[] = [];
    for (const asset of assets) {
      const inputPath = join(captureDir, asset.input);
      const outputFilename = sceneById(asset.scene).asset;
      const stagedPath = join(stagingDir, outputFilename);
      const seconds = durationSecondsForScene(asset.scene);
      await mkdir(dirname(stagedPath), { recursive: true });
      encodeAsset(asset, inputPath, stagedPath, seconds, contract);
      const metadata = probePreparedVideo(stagedPath, seconds, contract);
      outputs.push({
        scene: asset.scene,
        file: outputFilename,
        sha256: await sha256(stagedPath),
        ...metadata,
        sourceKind: asset.sourceKind,
        privacyTreatment: asset.privacyTreatment,
      });
      publications.push({ stagedPath, finalPath: join(publicDir, outputFilename) });
    }

    const provenance = {
      preparedAt: (options.now ?? (() => new Date()))().toISOString(),
      source:
        "Real signed-in iPhone 16 Pro simulator; raw captures retained outside the repository.",
      publicLocation: {
        label: "Flatiron District, New York, NY",
        latitude: 40.7411,
        longitude: -73.9897,
      },
      simulatorViewport: {
        width: contract.width,
        height: contract.height,
        fps: contract.fps,
      },
      captureRoutes: {
        map: "mapvest://map",
        localBrief: "mapvest://home?demoSection=local",
        universe: "mapvest://universe",
        daily: "mapvest://home?demoSection=daily",
      },
      outputs,
    };
    const stagedProvenancePath = join(stagingDir, "provenance", basename(provenancePath));
    await mkdir(dirname(stagedProvenancePath), { recursive: true });
    await Bun.write(stagedProvenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
    publications.push({ stagedPath: stagedProvenancePath, finalPath: provenancePath });

    await publishPreparedSet(publications, publicDir, force, renamePath);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }

  return { dryRun: false as const, plan, outputs, provenancePath };
};

if (import.meta.main) {
  const result = await prepareLaunchAssets(parsePrepareArguments(process.argv.slice(2)));
  if (result.dryRun) {
    console.log(JSON.stringify(result.plan, null, 2));
  } else {
    console.log(`Prepared ${result.outputs.length} privacy-safe launch assets.`);
    console.log(`Provenance: ${result.provenancePath}`);
  }
}
