import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LyriaInteractionContent, LyriaInteractionResponse } from "@mapvest/core/schemas";
import {
  assertMusicReplacementReady,
  promoteMusicArtifacts,
  requestLyria,
} from "./music-generation.js";

const ROOT = join(import.meta.dir, "..");
const PROMPT_PATH = join(ROOT, "music", "mapvest-launch.prompt.txt");
const OUTPUT_PATH = join(ROOT, "public", "music", "mapvest-launch.mp3");
const PROVENANCE_PATH = join(ROOT, "public", "music", "mapvest-launch.provenance.json");
const MODEL = "lyria-3-pro-preview";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const TARGET_DURATION_SECONDS = 58.5;

type AudioMetadata = {
  codec: string;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
};

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const dryRun = args.has("--dry-run");

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

const run = (command: string[]) => {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim();
    throw new Error(`${command[0]} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.toString();
};

const probeAudio = (path: string): AudioMetadata => {
  const raw = run([
    "ffprobe",
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=codec_name,sample_rate,channels:format=duration",
    "-of",
    "json",
    path,
  ]);
  const parsed = JSON.parse(raw) as {
    streams?: Array<{ codec_name?: string; sample_rate?: string; channels?: number }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0];
  const durationSeconds = Number(parsed.format?.duration);
  const sampleRate = Number(stream?.sample_rate);
  const channels = Number(stream?.channels);

  if (!stream?.codec_name || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Generated audio is not decodable.");
  }
  if (!Number.isFinite(sampleRate) || sampleRate < 22_050 || channels !== 2) {
    throw new Error(`Unexpected audio format: ${sampleRate} Hz, ${channels} channels.`);
  }

  return { codec: stream.codec_name, sampleRate, channels, durationSeconds };
};

const findAudio = (response: LyriaInteractionResponse): LyriaInteractionContent | undefined => {
  for (const step of response.steps) {
    const content = step.content ?? step.model_output?.content ?? [];
    const audio = content.find((item) => item.type === "audio" && item.data);
    if (audio) return audio;
  }
  return undefined;
};

const prompt = (await readFile(PROMPT_PATH, "utf8")).trim();

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        model: MODEL,
        endpoint: ENDPOINT,
        promptPath: PROMPT_PATH,
        promptSha256: sha256(prompt),
        outputPath: OUTPUT_PATH,
        targetDurationSeconds: TARGET_DURATION_SECONDS,
        estimatedGenerationCostUsd: 0.08,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

await assertMusicReplacementReady(
  { audioPath: OUTPUT_PATH, provenancePath: PROVENANCE_PATH },
  force,
);

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error(
    "GEMINI_API_KEY is missing. Run through Doppler project shared, config dev_personal.",
  );
}

console.log("Generating one Lyria 3 Pro song (estimated API cost: $0.08; no automatic retry).\n");

const payload = await requestLyria({
  endpoint: ENDPOINT,
  apiKey,
  model: MODEL,
  prompt,
});
const audio = findAudio(payload);
const mimeType = audio?.mime_type ?? audio?.mimeType;
if (!audio?.data || !mimeType?.startsWith("audio/")) {
  throw new Error("Lyria returned no supported audio content.");
}

const sourceBytes = Buffer.from(audio.data, "base64");
const outputDir = dirname(OUTPUT_PATH);
const tempSourcePath = join(outputDir, `.mapvest-launch-source-${process.pid}`);
const tempOutputPath = join(outputDir, `.mapvest-launch-${process.pid}.mp3`);
const tempProvenancePath = join(outputDir, `.mapvest-launch-${process.pid}.json`);

await mkdir(outputDir, { recursive: true });

try {
  await Bun.write(tempSourcePath, sourceBytes);
  const sourceMetadata = probeAudio(tempSourcePath);
  if (sourceMetadata.durationSeconds < TARGET_DURATION_SECONDS) {
    throw new Error(
      `Lyria output is ${sourceMetadata.durationSeconds.toFixed(1)}s; expected at least ${TARGET_DURATION_SECONDS}s. No retry was attempted.`,
    );
  }

  run([
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    tempSourcePath,
    "-t",
    String(TARGET_DURATION_SECONDS),
    "-af",
    "afade=t=in:st=0:d=0.25,afade=t=out:st=55.5:d=3,loudnorm=I=-20:LRA=7:TP=-2",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-codec:a",
    "libmp3lame",
    "-q:a",
    "2",
    tempOutputPath,
  ]);

  const normalizedMetadata = probeAudio(tempOutputPath);
  const outputBytes = new Uint8Array(await Bun.file(tempOutputPath).arrayBuffer());
  const provenance = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    endpoint: "/v1beta/interactions",
    store: false,
    promptPath: "music/mapvest-launch.prompt.txt",
    promptSha256: sha256(prompt),
    sourceMimeType: mimeType,
    sourceSha256: sha256(sourceBytes),
    sourceDurationSeconds: Number(sourceMetadata.durationSeconds.toFixed(3)),
    outputSha256: sha256(outputBytes),
    outputDurationSeconds: Number(normalizedMetadata.durationSeconds.toFixed(3)),
    codec: normalizedMetadata.codec,
    sampleRate: normalizedMetadata.sampleRate,
    channels: normalizedMetadata.channels,
    synthId: true,
    instrumentalOnlyRequested: true,
    estimatedGenerationCostUsd: 0.08,
  };

  await Bun.write(tempProvenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  await promoteMusicArtifacts({
    staged: { audioPath: tempOutputPath, provenancePath: tempProvenancePath },
    accepted: { audioPath: OUTPUT_PATH, provenancePath: PROVENANCE_PATH },
    force,
  });
  console.log(`Accepted soundtrack: ${OUTPUT_PATH}`);
  console.log(`Provenance: ${PROVENANCE_PATH}`);
} finally {
  await Promise.all([
    rm(tempSourcePath, { force: true }),
    rm(tempOutputPath, { force: true }),
    rm(tempProvenancePath, { force: true }),
  ]);
}
