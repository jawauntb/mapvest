import { expect, test } from "bun:test";
import { constants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { LyriaInteractionResponse } from "@mapvest/core/schemas";
import {
  TARGET_DURATION_SECONDS,
  assertAudioPacketCoverage,
  assertSamePacketFingerprint,
  defaultMusicAlternativeMediaTools,
  runBoundedMediaCommand,
} from "./music-alternative-media.js";
import type { MusicAlternativesPublication } from "./music-alternatives-lifecycle.js";
import {
  MUSIC_ALTERNATIVES,
  type MusicAlternativeDefinition,
  type MusicAlternativesDependencies,
  generateMusicAlternatives,
  verifyMusicAlternatives,
} from "./music-alternatives.js";

const FIXTURE_COMMAND_TIMEOUT_MS = 2 * 60_000;
const INTEGRATION_TEST_TIMEOUT_MS = 6 * 60_000;
const SOURCE_AUDIO_DURATION_SECONDS = 73;

const runFixtureFfmpeg = async (arguments_: string[]) =>
  runBoundedMediaCommand(
    ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", ...arguments_],
    { timeoutMs: FIXTURE_COMMAND_TIMEOUT_MS, captureStdout: false },
  );

const createSilentMaster = async (path: string, resolution: "1080x1920" | "1080x1080") => {
  await runFixtureFfmpeg([
    "-n",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x111827:s=${resolution}:r=30:d=${TARGET_DURATION_SECONDS}`,
    "-map",
    "0:v:0",
    "-an",
    "-t",
    String(TARGET_DURATION_SECONDS),
    "-codec:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "zerolatency",
    "-crf",
    "51",
    "-g",
    "300",
    "-keyint_min",
    "300",
    "-sc_threshold",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-map_metadata",
    "-1",
    "-movflags",
    "+faststart",
    path,
  ]);
};

const createSourceAudio = async (path: string) => {
  await runFixtureFfmpeg([
    "-n",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=523.25:sample_rate=48000:duration=${SOURCE_AUDIO_DURATION_SECONDS}`,
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    "2",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "64k",
    "-map_metadata",
    "-1",
    path,
  ]);
};

const isMissingPathError = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const assertPathMissing = async (path: string) => {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
  throw new Error(`Test publication destination already exists: ${JSON.stringify(path)}`);
};

const localNoClobberPublication: MusicAlternativesPublication = {
  preflight: async (parentDirectory) => {
    await access(parentDirectory, constants.R_OK | constants.W_OK);
  },
  publish: async (stagingDirectory, outputDirectory) => {
    if (
      dirname(stagingDirectory) !== dirname(outputDirectory) ||
      !basename(stagingDirectory).startsWith(`.${basename(outputDirectory)}.staging-`)
    ) {
      throw new Error("Test publication may move only the workflow-owned sibling staging set.");
    }
    await assertPathMissing(outputDirectory);
    await rename(stagingDirectory, outputDirectory);
  },
};

const fakeLyriaAudioResponse = (audioBase64: string): LyriaInteractionResponse => ({
  steps: [
    {
      content: [
        {
          type: "audio",
          data: audioBase64,
          mime_type: "audio/mpeg",
        },
      ],
    },
  ],
});

test(
  "generates and verifies four alternatives offline through the real FFmpeg toolchain",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "mapvest-music-alternatives-ffmpeg-"));
    const promptDirectory = join(root, "prompts");
    const portraitMaster = join(root, "portrait-silent.mp4");
    const squareMaster = join(root, "square-silent.mp4");
    const sourceAudio = join(root, "synthetic-source.mp3");
    const outputDirectory = join(root, "published-audition");

    try {
      await mkdir(promptDirectory);
      await createSilentMaster(portraitMaster, "1080x1920");
      await createSilentMaster(squareMaster, "1080x1080");
      await createSourceAudio(sourceAudio);

      const sourceMetadata = await defaultMusicAlternativeMediaTools.probeAudio(sourceAudio);
      expect(sourceMetadata.durationSeconds).toBeGreaterThanOrEqual(72);
      expect(sourceMetadata.durationSeconds).toBeLessThanOrEqual(75);

      const candidates: MusicAlternativeDefinition[] = MUSIC_ALTERNATIVES.map((candidate) => ({
        ...candidate,
        promptPath: join(promptDirectory, `${candidate.id}.prompt.txt`),
      }));
      await Promise.all(
        candidates.map((candidate) =>
          writeFile(candidate.promptPath, `offline integration prompt for ${candidate.id}`),
        ),
      );

      const audioBase64 = (await readFile(sourceAudio)).toString("base64");
      const fakeResponses = candidates.map(() => fakeLyriaAudioResponse(audioBase64));
      const requestedCandidateIds: string[] = [];
      const dependencies: MusicAlternativesDependencies = {
        requestLyria: async (candidate, _prompt, apiKey, signal) => {
          expect(apiKey).toBe("offline-test-key");
          expect(signal.aborted).toBe(false);
          const response = fakeResponses[requestedCandidateIds.length];
          if (!response) throw new Error("The workflow attempted more than four provider calls.");
          requestedCandidateIds.push(candidate.id);
          return response;
        },
        media: defaultMusicAlternativeMediaTools,
        publication: localNoClobberPublication,
        now: () => new Date("2026-08-29T12:00:00.000Z"),
        pathPolicy: {
          allowedUserRoot: root,
          promptRoot: promptDirectory,
        },
        signals: {
          add: () => {},
          remove: () => {},
          report: () => {},
          exit: () => {},
        },
      };
      const options = {
        outputDirectory,
        portraitMaster,
        squareMaster,
        candidates,
        apiKey: "offline-test-key",
      };

      const generated = await generateMusicAlternatives(options, dependencies);
      expect(generated.mode).toBe("generated");
      if (generated.mode !== "generated") throw new Error("Expected a generated audition set.");
      expect(requestedCandidateIds).toEqual(candidates.map(({ id }) => id));
      expect(fakeResponses).toHaveLength(4);

      const [portraitMasterPackets, squareMasterPackets] = await Promise.all([
        defaultMusicAlternativeMediaTools.packetFingerprint(portraitMaster, "video"),
        defaultMusicAlternativeMediaTools.packetFingerprint(squareMaster, "video"),
      ]);
      for (const candidate of generated.manifest.candidates) {
        const portraitPath = join(outputDirectory, candidate.portraitVideoPath);
        const squarePath = join(outputDirectory, candidate.squareVideoPath);
        const [portraitVideoPackets, squareVideoPackets, portraitAudioPackets, squareAudioPackets] =
          await Promise.all([
            defaultMusicAlternativeMediaTools.packetFingerprint(portraitPath, "video"),
            defaultMusicAlternativeMediaTools.packetFingerprint(squarePath, "video"),
            defaultMusicAlternativeMediaTools.packetFingerprint(portraitPath, "audio"),
            defaultMusicAlternativeMediaTools.packetFingerprint(squarePath, "audio"),
          ]);
        assertSamePacketFingerprint(
          portraitVideoPackets,
          portraitMasterPackets,
          `${candidate.title} portrait master video`,
        );
        assertSamePacketFingerprint(
          squareVideoPackets,
          squareMasterPackets,
          `${candidate.title} square master video`,
        );
        assertAudioPacketCoverage(portraitAudioPackets, `${candidate.title} portrait AAC`);
        assertAudioPacketCoverage(squareAudioPackets, `${candidate.title} square AAC`);
        assertSamePacketFingerprint(
          portraitAudioPackets,
          squareAudioPackets,
          `${candidate.title} portrait/square AAC`,
        );
      }

      let verificationProviderCalls = 0;
      dependencies.requestLyria = async () => {
        verificationProviderCalls += 1;
        throw new Error("Offline verification must not call Lyria.");
      };
      const verified = await verifyMusicAlternatives(
        { outputDirectory, portraitMaster, squareMaster, candidates },
        dependencies,
      );
      expect(verificationProviderCalls).toBe(0);
      expect(verified).toEqual(generated.manifest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);
