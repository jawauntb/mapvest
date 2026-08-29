import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";

const DURATION_TOLERANCE_SECONDS = 0.06;
export const TARGET_DURATION_SECONDS = 58.5;

export type AudioMetadata = {
  codec: string;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
};

type VideoStreamMetadata = {
  type: "video";
  codec: string;
  width: number;
  height: number;
  frameRate: number;
  pixelFormat?: string;
};

type AudioStreamMetadata = {
  type: "audio";
  codec: string;
  sampleRate: number;
  channels: number;
};

export type MediaMetadata = {
  durationSeconds: number;
  streams: Array<VideoStreamMetadata | AudioStreamMetadata>;
};

export type PacketFingerprint = {
  packetCount: number;
  sha256: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  maxUncoveredGapSeconds?: number;
};

type MediaOperationOptions = { signal?: AbortSignal };

export type MusicAlternativeMediaTools = {
  preflight: (options?: MediaOperationOptions) => Promise<void>;
  probeAudio: (path: string, options?: MediaOperationOptions) => Promise<AudioMetadata>;
  normalizeMp3: (
    options: { sourcePath: string; outputPath: string } & MediaOperationOptions,
  ) => Promise<void>;
  encodeAac: (
    options: { inputPath: string; outputPath: string } & MediaOperationOptions,
  ) => Promise<void>;
  mux: (
    options: { masterPath: string; audioPath: string; outputPath: string } & MediaOperationOptions,
  ) => Promise<void>;
  probeMedia: (path: string, options?: MediaOperationOptions) => Promise<MediaMetadata>;
  packetFingerprint: (
    path: string,
    stream: "video" | "audio",
    options?: MediaOperationOptions,
  ) => Promise<PacketFingerprint>;
};

const PROBE_TIMEOUT_MS = 60_000;
const TRANSCODE_TIMEOUT_MS = 5 * 60_000;
const TOOLCHAIN_PREFLIGHT_TIMEOUT_MS = 30_000;
const PROCESS_TERMINATION_GRACE_MS = 500;
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 16 * 1024;
const CHILD_ENVIRONMENT_KEYS = ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE"];

type BoundedCommandOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  captureStdout?: boolean;
};

const readBounded = async (stream: ReadableStream<Uint8Array>, limit: number, retain: boolean) => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let retainedBytes = 0;
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (!retain || retainedBytes >= limit) continue;
      const remaining = limit - retainedBytes;
      const chunk = value.byteLength <= remaining ? value : value.subarray(0, remaining);
      chunks.push(chunk);
      retainedBytes += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(retainedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    text: new TextDecoder().decode(bytes),
    truncated: totalBytes > limit,
  };
};

const abortError = (message: string) => {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
};

const mediaCommandEnvironment = () =>
  Object.fromEntries(
    CHILD_ENVIRONMENT_KEYS.flatMap((key) => {
      const value = process.env[key];
      return value === undefined ? [] : [[key, value] as const];
    }),
  );

const resolveMediaExecutable = async (executable: string) => {
  const resolved = isAbsolute(executable) ? executable : Bun.which(executable);
  if (!resolved) throw new Error(`Media executable was not found on PATH: ${executable}`);
  return realpath(resolved);
};

/**
 * Runs one media command without a shell, bounds both runtime and captured
 * output, and escalates from TERM to KILL if the tool does not exit promptly.
 * Exported only so the timeout/abort contract can be tested without invoking
 * a paid generation path.
 */
export const runBoundedMediaCommand = async (
  command: string[],
  { timeoutMs, signal, captureStdout = true }: BoundedCommandOptions,
): Promise<string> => {
  if (command.length === 0) throw new Error("Media command may not be empty.");
  const requestedExecutable = command[0];
  if (!requestedExecutable) throw new Error("Media command may not be empty.");
  if (signal?.aborted) throw abortError(`${requestedExecutable} was cancelled before it started.`);

  const executable = await resolveMediaExecutable(requestedExecutable);
  const resolvedCommand = [executable, ...command.slice(1)];

  const subprocess = Bun.spawn(resolvedCommand, {
    env: mediaCommandEnvironment(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let cancelled = false;
  let escalationTimer: ReturnType<typeof setTimeout> | undefined;
  const terminate = () => {
    try {
      subprocess.kill("SIGTERM");
    } catch {
      // It may have exited between the status check and kill.
    }
    escalationTimer = setTimeout(() => {
      try {
        subprocess.kill("SIGKILL");
      } catch {
        // It already exited.
      }
    }, PROCESS_TERMINATION_GRACE_MS);
  };
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, timeoutMs);
  const onAbort = () => {
    cancelled = true;
    terminate();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const stdoutPromise = readBounded(subprocess.stdout, MAX_STDOUT_BYTES, captureStdout);
  const stderrPromise = readBounded(subprocess.stderr, MAX_DIAGNOSTIC_BYTES, true);
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    stdoutPromise,
    stderrPromise,
  ]);
  clearTimeout(timeoutTimer);
  if (escalationTimer) clearTimeout(escalationTimer);
  signal?.removeEventListener("abort", onAbort);

  const tool = command[0] ?? "media command";
  const diagnostic = stderr.text.trim();
  const diagnosticSuffix = stderr.truncated ? "\n[diagnostic output truncated]" : "";
  if (timedOut) {
    throw new Error(`${tool} timed out after ${Math.ceil(timeoutMs / 1_000)} seconds.`);
  }
  if (cancelled) throw abortError(`${tool} was cancelled.`);
  if (stdout.truncated && captureStdout) {
    throw new Error(`${tool} output exceeded the ${MAX_STDOUT_BYTES}-byte safety limit.`);
  }
  if (exitCode !== 0) {
    throw new Error(
      `${tool} failed with exit code ${exitCode}${diagnostic ? `: ${diagnostic}${diagnosticSuffix}` : ""}`,
    );
  }
  return stdout.text;
};

const parseFrameRate = (value: string | undefined) => {
  if (!value) return Number.NaN;
  const [numerator, denominator = "1"] = value.split("/");
  return Number(numerator) / Number(denominator);
};

const probeAudio = async (
  path: string,
  options: MediaOperationOptions = {},
): Promise<AudioMetadata> => {
  const raw = await runBoundedMediaCommand(
    [
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
    ],
    { timeoutMs: PROBE_TIMEOUT_MS, signal: options.signal },
  );
  const parsed = JSON.parse(raw) as {
    streams?: Array<{ codec_name?: string; sample_rate?: string; channels?: number }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0];
  const metadata: AudioMetadata = {
    codec: stream?.codec_name ?? "",
    sampleRate: Number(stream?.sample_rate),
    channels: Number(stream?.channels),
    durationSeconds: Number(parsed.format?.duration),
  };
  if (
    !metadata.codec ||
    !Number.isFinite(metadata.sampleRate) ||
    !Number.isFinite(metadata.channels) ||
    !Number.isFinite(metadata.durationSeconds) ||
    metadata.durationSeconds <= 0
  ) {
    throw new Error(`Audio is not decodable: ${path}`);
  }
  return metadata;
};

const probeMedia = async (
  path: string,
  options: MediaOperationOptions = {},
): Promise<MediaMetadata> => {
  const raw = await runBoundedMediaCommand(
    [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,channels:format=duration",
      "-of",
      "json",
      path,
    ],
    { timeoutMs: PROBE_TIMEOUT_MS, signal: options.signal },
  );
  const parsed = JSON.parse(raw) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      pix_fmt?: string;
      sample_rate?: string;
      channels?: number;
    }>;
    format?: { duration?: string };
  };
  const durationSeconds = Number(parsed.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`Media duration is invalid: ${path}`);
  }
  const streams = (parsed.streams ?? []).flatMap<VideoStreamMetadata | AudioStreamMetadata>(
    (stream) => {
      if (stream.codec_type === "video") {
        return [
          {
            type: "video",
            codec: stream.codec_name ?? "",
            width: Number(stream.width),
            height: Number(stream.height),
            frameRate: parseFrameRate(stream.r_frame_rate),
            pixelFormat: stream.pix_fmt,
          },
        ];
      }
      if (stream.codec_type === "audio") {
        return [
          {
            type: "audio",
            codec: stream.codec_name ?? "",
            sampleRate: Number(stream.sample_rate),
            channels: Number(stream.channels),
          },
        ];
      }
      return [];
    },
  );
  return { durationSeconds, streams };
};

const packetFingerprint = async (
  path: string,
  stream: "video" | "audio",
  options: MediaOperationOptions = {},
): Promise<PacketFingerprint> => {
  const raw = await runBoundedMediaCommand(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      stream === "video" ? "v:0" : "a:0",
      "-show_packets",
      "-show_entries",
      "packet=pts,dts,duration,pts_time,dts_time,duration_time,size,flags,data_hash",
      "-show_data_hash",
      "sha256",
      "-of",
      "json",
      path,
    ],
    { timeoutMs: PROBE_TIMEOUT_MS, signal: options.signal },
  );
  const parsed = JSON.parse(raw) as {
    packets?: Array<{
      pts?: number;
      dts?: number;
      duration?: number;
      pts_time?: string;
      dts_time?: string;
      duration_time?: string;
      size?: string;
      flags?: string;
      data_hash?: string;
    }>;
  };
  const packets = (parsed.packets ?? []).map((packet) => ({
    pts: packet.pts ?? null,
    dts: packet.dts ?? null,
    duration: packet.duration ?? null,
    ptsTime: packet.pts_time ?? "",
    dtsTime: packet.dts_time ?? "",
    durationTime: packet.duration_time ?? "",
    size: packet.size ?? "",
    flags: packet.flags ?? "",
    dataHash: packet.data_hash ?? "",
  }));
  if (
    packets.length === 0 ||
    packets.some(
      (packet) =>
        !packet.size ||
        !packet.dataHash ||
        !packet.ptsTime ||
        !packet.dtsTime ||
        !packet.durationTime,
    )
  ) {
    throw new Error(`Could not fingerprint ${stream} packets: ${path}`);
  }
  const packetTimelines = packets.map((packet) => ({
    start: Number(packet.ptsTime),
    duration: Number(packet.durationTime),
  }));
  if (
    packetTimelines.some(
      ({ start, duration }) =>
        !Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0,
    )
  ) {
    throw new Error(`Could not read ${stream} packet timing: ${path}`);
  }
  const sortedTimelines = [...packetTimelines].sort((left, right) => left.start - right.start);
  const [firstTimeline, ...remainingTimelines] = sortedTimelines;
  if (!firstTimeline) throw new Error(`Could not fingerprint ${stream} packets: ${path}`);
  let coveredThrough = firstTimeline.start + firstTimeline.duration;
  let maxUncoveredGapSeconds = 0;
  for (const interval of remainingTimelines) {
    maxUncoveredGapSeconds = Math.max(maxUncoveredGapSeconds, interval.start - coveredThrough);
    coveredThrough = Math.max(coveredThrough, interval.start + interval.duration);
  }
  return {
    packetCount: packets.length,
    sha256: createHash("sha256").update(JSON.stringify(packets)).digest("hex"),
    startTimeSeconds: Math.min(...packetTimelines.map(({ start }) => start)),
    endTimeSeconds: Math.max(...packetTimelines.map(({ start, duration }) => start + duration)),
    ...(stream === "audio" ? { maxUncoveredGapSeconds } : {}),
  };
};

export const defaultMusicAlternativeMediaTools: MusicAlternativeMediaTools = {
  preflight: async ({ signal } = {}) => {
    await runBoundedMediaCommand(["ffprobe", "-v", "error", "-version"], {
      timeoutMs: TOOLCHAIN_PREFLIGHT_TIMEOUT_MS,
      signal,
      captureStdout: false,
    });
    await runBoundedMediaCommand(
      [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-t",
        "1",
        "-af",
        "atrim=start=0:end=1,afade=t=in:st=0:d=0.01,afade=t=out:st=0.9:d=0.1,loudnorm=I=-20:LRA=7:TP=-2",
        "-ac",
        "2",
        "-codec:a",
        "libmp3lame",
        "-f",
        "mp3",
        "pipe:1",
      ],
      { timeoutMs: TOOLCHAIN_PREFLIGHT_TIMEOUT_MS, signal, captureStdout: false },
    );
    await runBoundedMediaCommand(
      [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-t",
        "0.1",
        "-codec:a",
        "aac",
        "-ac",
        "2",
        "-movflags",
        "frag_keyframe+empty_moov",
        "-f",
        "mp4",
        "pipe:1",
      ],
      { timeoutMs: TOOLCHAIN_PREFLIGHT_TIMEOUT_MS, signal, captureStdout: false },
    );
  },
  probeAudio,
  normalizeMp3: async ({ sourcePath, outputPath, signal }) => {
    await runBoundedMediaCommand(
      [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-n",
        "-i",
        sourcePath,
        "-map",
        "0:a:0",
        "-vn",
        "-t",
        String(TARGET_DURATION_SECONDS),
        "-af",
        "atrim=start=0:end=58.5,afade=t=in:st=0:d=0.2,afade=t=out:st=55.5:d=3,loudnorm=I=-20:LRA=7:TP=-2",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-codec:a",
        "libmp3lame",
        "-q:a",
        "2",
        "-map_metadata",
        "-1",
        outputPath,
      ],
      { timeoutMs: TRANSCODE_TIMEOUT_MS, signal, captureStdout: false },
    );
  },
  encodeAac: async ({ inputPath, outputPath, signal }) => {
    await runBoundedMediaCommand(
      [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-n",
        "-i",
        inputPath,
        "-map",
        "0:a:0",
        "-vn",
        "-t",
        String(TARGET_DURATION_SECONDS),
        "-ar",
        "48000",
        "-ac",
        "2",
        "-codec:a",
        "aac",
        "-b:a",
        "192k",
        "-map_metadata",
        "-1",
        outputPath,
      ],
      { timeoutMs: TRANSCODE_TIMEOUT_MS, signal, captureStdout: false },
    );
  },
  mux: async ({ masterPath, audioPath, outputPath, signal }) => {
    await runBoundedMediaCommand(
      [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-n",
        "-i",
        masterPath,
        "-i",
        audioPath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-codec:v",
        "copy",
        "-codec:a",
        "copy",
        "-t",
        String(TARGET_DURATION_SECONDS),
        "-map_metadata",
        "-1",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { timeoutMs: TRANSCODE_TIMEOUT_MS, signal, captureStdout: false },
    );
  },
  probeMedia,
  packetFingerprint,
};

const assertDuration = (durationSeconds: number, label: string) => {
  if (Math.abs(durationSeconds - TARGET_DURATION_SECONDS) > DURATION_TOLERANCE_SECONDS) {
    throw new Error(
      `${label} must be ${TARGET_DURATION_SECONDS}s; received ${durationSeconds.toFixed(3)}s.`,
    );
  }
};

export const assertNormalizedMp3Contract = (metadata: AudioMetadata, label: string) => {
  if (
    metadata.codec !== "mp3" ||
    Math.abs(metadata.durationSeconds - TARGET_DURATION_SECONDS) > DURATION_TOLERANCE_SECONDS ||
    metadata.sampleRate !== 48_000 ||
    metadata.channels !== 2
  ) {
    throw new Error(`${label} must be a 58.5s, 48 kHz stereo MP3.`);
  }
};

export const assertMasterMediaContract = (
  metadata: MediaMetadata,
  format: "portrait" | "square",
) => {
  assertDuration(metadata.durationSeconds, `${format} silent master`);
  const video = metadata.streams.filter(
    (stream): stream is VideoStreamMetadata => stream.type === "video",
  );
  const audio = metadata.streams.filter((stream) => stream.type === "audio");
  const expectedHeight = format === "portrait" ? 1920 : 1080;
  if (video.length !== 1 || audio.length !== 0) {
    throw new Error(`${format} master must contain one H.264 video stream and remain silent.`);
  }
  if (
    video[0]?.codec !== "h264" ||
    video[0].width !== 1080 ||
    video[0].height !== expectedHeight ||
    Math.abs(video[0].frameRate - 30) > 0.001
  ) {
    throw new Error(`${format} master must be H.264 at 1080x${expectedHeight}, 30 fps.`);
  }
};

export const assertMuxedMediaContract = (
  metadata: MediaMetadata,
  format: "portrait" | "square",
) => {
  assertDuration(metadata.durationSeconds, `${format} candidate video`);
  const video = metadata.streams.filter(
    (stream): stream is VideoStreamMetadata => stream.type === "video",
  );
  const audio = metadata.streams.filter(
    (stream): stream is AudioStreamMetadata => stream.type === "audio",
  );
  const expectedHeight = format === "portrait" ? 1920 : 1080;
  if (
    video.length !== 1 ||
    video[0]?.codec !== "h264" ||
    video[0].width !== 1080 ||
    video[0].height !== expectedHeight ||
    Math.abs(video[0].frameRate - 30) > 0.001
  ) {
    throw new Error(
      `${format} candidate must contain one H.264 video stream at 1080x${expectedHeight}, 30 fps.`,
    );
  }
  if (
    audio.length !== 1 ||
    audio[0]?.codec !== "aac" ||
    audio[0].sampleRate !== 48_000 ||
    audio[0].channels !== 2
  ) {
    throw new Error(`${format} candidate must contain exactly one 48 kHz stereo AAC stream.`);
  }
};

export const assertSamePacketFingerprint = (
  actual: PacketFingerprint,
  expected: PacketFingerprint,
  label: string,
) => {
  if (
    actual.packetCount !== expected.packetCount ||
    actual.sha256 !== expected.sha256 ||
    actual.startTimeSeconds !== expected.startTimeSeconds ||
    actual.endTimeSeconds !== expected.endTimeSeconds ||
    (expected.maxUncoveredGapSeconds !== undefined &&
      actual.maxUncoveredGapSeconds !== expected.maxUncoveredGapSeconds)
  ) {
    throw new Error(`${label} packet identity changed.`);
  }
};

export const assertAudioPacketCoverage = (fingerprint: PacketFingerprint, label: string) => {
  if (
    Math.abs(fingerprint.startTimeSeconds) > DURATION_TOLERANCE_SECONDS ||
    fingerprint.endTimeSeconds < TARGET_DURATION_SECONDS - DURATION_TOLERANCE_SECONDS ||
    (fingerprint.maxUncoveredGapSeconds !== undefined &&
      fingerprint.maxUncoveredGapSeconds > DURATION_TOLERANCE_SECONDS)
  ) {
    throw new Error(
      `${label} packets must cover the complete ${TARGET_DURATION_SECONDS}s timeline; received ${fingerprint.startTimeSeconds.toFixed(3)}s to ${fingerprint.endTimeSeconds.toFixed(3)}s.`,
    );
  }
};

export const sha256File = async (path: string) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};
