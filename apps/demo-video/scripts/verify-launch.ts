import { join } from "node:path";
import { COMPOSITION_VARIANTS, FPS, TOTAL_DURATION_IN_FRAMES } from "../src/storyboard";
import {
  RENDER_MANIFEST_FILENAME,
  assertRenderManifestCurrent,
  collectLaunchInputSnapshot,
  sha256File,
  validatePreparedLaunchAssets,
} from "./launch-integrity";

const ROOT = join(import.meta.dir, "..");
const OUT_DIR = join(ROOT, "out");
const EXPECTED_DURATION = TOTAL_DURATION_IN_FRAMES / FPS;

type ProbeStream = {
  codec_type?: "video" | "audio";
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
};

const run = (command: string[]) => {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    throw new Error(`${command[0]} failed${detail ? `: ${detail}` : ""}`);
  }
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString() };
};

const probe = (path: string) => {
  const raw = run([
    "ffprobe",
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels:format=duration",
    "-of",
    "json",
    path,
  ]).stdout;
  return JSON.parse(raw) as { streams?: ProbeStream[]; format?: { duration?: string } };
};

const visualSsim = (first: string, second: string) => {
  const { stderr } = run([
    "ffmpeg",
    "-hide_banner",
    "-i",
    first,
    "-i",
    second,
    "-lavfi",
    "ssim",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  const matches = [...stderr.matchAll(/All:([0-9.]+)/g)];
  const score = Number(matches.at(-1)?.[1]);
  if (!Number.isFinite(score)) throw new Error("FFmpeg did not report an SSIM score.");
  return score;
};

await validatePreparedLaunchAssets(ROOT);
const currentInputs = await collectLaunchInputSnapshot(ROOT);
const manifestPath = join(OUT_DIR, RENDER_MANIFEST_FILENAME);
if (!(await Bun.file(manifestPath).exists())) {
  throw new Error(
    `Missing completed render manifest: ${manifestPath}. Run \`bun scripts/launch-video.ts render\` to create one atomic four-variant set.`,
  );
}
let rawManifest: unknown;
try {
  rawManifest = JSON.parse(await Bun.file(manifestPath).text()) as unknown;
} catch (error) {
  throw new Error(
    `Completed render manifest is not valid JSON: ${error instanceof Error ? error.message : error}`,
  );
}
const actualRenderDigests = await Promise.all(
  COMPOSITION_VARIANTS.map(async ({ id, outputFilename }) => {
    const path = join(OUT_DIR, outputFilename);
    if (!(await Bun.file(path).exists())) throw new Error(`Missing render: ${path}`);
    return { id, file: outputFilename, sha256: await sha256File(path) };
  }),
);
const completedRun = assertRenderManifestCurrent(rawManifest, currentInputs, actualRenderDigests);

const renderPaths = new Map<string, string>();
const results = [] as Array<Record<string, unknown>>;

for (const variant of COMPOSITION_VARIANTS) {
  const path = join(OUT_DIR, variant.outputFilename);
  const metadata = probe(path);
  const video = metadata.streams?.find(({ codec_type }) => codec_type === "video");
  const audio = metadata.streams?.find(({ codec_type }) => codec_type === "audio");
  const duration = Number(metadata.format?.duration);

  if (
    video?.codec_name !== "h264" ||
    video.width !== variant.width ||
    video.height !== variant.height ||
    video.r_frame_rate !== `${FPS}/1` ||
    video.pix_fmt !== "yuv420p"
  ) {
    throw new Error(`Video contract failed for ${variant.outputFilename}`);
  }
  if (!Number.isFinite(duration) || Math.abs(duration - EXPECTED_DURATION) > 0.08) {
    throw new Error(`Duration contract failed for ${variant.outputFilename}: ${duration}`);
  }
  if (variant.soundtrack === "music") {
    if (audio?.codec_name !== "aac" || audio.channels !== 2) {
      throw new Error(`Music render lacks stereo AAC: ${variant.outputFilename}`);
    }
  } else if (audio) {
    throw new Error(`Silent render unexpectedly contains audio: ${variant.outputFilename}`);
  }

  renderPaths.set(`${variant.format}:${variant.soundtrack}`, path);
  results.push({
    id: variant.id,
    file: variant.outputFilename,
    width: video.width,
    height: video.height,
    durationSeconds: Number(duration.toFixed(3)),
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
  });
}

const visualParity = [] as Array<{ format: "portrait" | "square"; ssim: number }>;
for (const format of ["portrait", "square"] as const) {
  const music = renderPaths.get(`${format}:music`);
  const silent = renderPaths.get(`${format}:silent`);
  if (!music || !silent) throw new Error(`Missing ${format} visual-parity inputs.`);
  const ssim = visualSsim(music, silent);
  if (ssim < 0.999) {
    throw new Error(`${format} music and silent visuals diverge: SSIM ${ssim.toFixed(6)}.`);
  }
  visualParity.push({ format, ssim: Number(ssim.toFixed(6)) });
}

console.log(
  JSON.stringify(
    {
      runId: completedRun.runId,
      completedAt: completedRun.completedAt,
      expectedDurationSeconds: EXPECTED_DURATION,
      renders: results,
      visualParity,
    },
    null,
    2,
  ),
);
console.log(
  "Launch renders satisfy input provenance, completed-run hashes, codec, duration, audio, and shared-visual contracts.",
);
