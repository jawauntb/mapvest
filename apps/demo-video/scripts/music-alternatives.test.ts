import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { LyriaInteractionResponse } from "@mapvest/core/schemas";
import {
  type MediaMetadata,
  TARGET_DURATION_SECONDS,
  assertAudioPacketCoverage,
  assertMasterMediaContract,
  assertMuxedMediaContract,
  assertSamePacketFingerprint,
  runBoundedMediaCommand,
} from "./music-alternative-media.js";
import {
  createMusicAlternativesPublication,
  defaultMusicAlternativesPublication,
} from "./music-alternatives-lifecycle.js";
import {
  ESTIMATED_ALTERNATIVES_COST_USD,
  MUSIC_ALTERNATIVES,
  MUSIC_ALTERNATIVES_MANIFEST,
  type MusicAlternativeDefinition,
  type MusicAlternativesDependencies,
  expectedAlternativeArtifactNames,
  generateMusicAlternatives,
  verifyMusicAlternatives,
} from "./music-alternatives.js";

const validMasterMetadata = (format: "portrait" | "square"): MediaMetadata => ({
  durationSeconds: TARGET_DURATION_SECONDS,
  streams: [
    {
      type: "video",
      codec: "h264",
      width: 1080,
      height: format === "portrait" ? 1920 : 1080,
      frameRate: 30,
      pixelFormat: "yuv420p",
    },
  ],
});

const validMuxedMetadata = (format: "portrait" | "square"): MediaMetadata => ({
  durationSeconds: TARGET_DURATION_SECONDS,
  streams: [
    ...validMasterMetadata(format).streams,
    { type: "audio" as const, codec: "aac", sampleRate: 48_000, channels: 2 },
  ],
});

const responseWithAudio = (value: string): LyriaInteractionResponse => ({
  steps: [
    {
      content: [
        {
          type: "audio",
          data: Buffer.from(value).toString("base64"),
          mime_type: "audio/wav",
        },
      ],
    },
  ],
});

const fixtureSha256 = (value: string) => createHash("sha256").update(value).digest("hex");

type Fixture = {
  root: string;
  promptDirectory: string;
  outputDirectory: string;
  portraitMaster: string;
  squareMaster: string;
  candidates: MusicAlternativeDefinition[];
};

const makeFixture = async (): Promise<Fixture> => {
  const root = await mkdtemp(join(tmpdir(), "mapvest-music-alternatives-"));
  const promptDirectory = join(root, "prompts");
  const portraitMaster = join(root, "portrait-silent.mp4");
  const squareMaster = join(root, "square-silent.mp4");
  await mkdir(promptDirectory);
  await Promise.all([
    writeFile(portraitMaster, "immutable portrait master"),
    writeFile(squareMaster, "immutable square master"),
  ]);

  const candidates = MUSIC_ALTERNATIVES.map((candidate) => ({
    ...candidate,
    promptPath: join(promptDirectory, `${candidate.id}.prompt.txt`),
  }));
  await Promise.all(
    candidates.map((candidate) => writeFile(candidate.promptPath, `prompt:${candidate.id}`)),
  );

  return {
    root,
    promptDirectory,
    outputDirectory: join(root, "published-audition"),
    portraitMaster,
    squareMaster,
    candidates,
  };
};

const fixtureDependencies = (
  fixture: Fixture,
  request: MusicAlternativesDependencies["requestLyria"],
): MusicAlternativesDependencies => ({
  requestLyria: request,
  now: () => new Date("2026-08-29T12:00:00.000Z"),
  publication: {
    preflight: async () => {},
    publish: async (stagingDirectory, outputDirectory) => {
      try {
        await stat(outputDirectory);
        throw new Error(`Music alternatives destination already exists: ${outputDirectory}`);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      await rename(stagingDirectory, outputDirectory);
    },
  },
  pathPolicy: {
    allowedUserRoot: fixture.root,
    promptRoot: fixture.promptDirectory,
  },
  signals: {
    add: () => {},
    remove: () => {},
    report: () => {},
    exit: () => {},
  },
  media: {
    preflight: async () => {},
    probeAudio: async (path) =>
      path.endsWith(".mp3")
        ? {
            codec: "mp3",
            sampleRate: 48_000,
            channels: 2,
            durationSeconds: TARGET_DURATION_SECONDS,
          }
        : {
            codec: "pcm_s16le",
            sampleRate: 48_000,
            channels: 2,
            durationSeconds: 73,
          },
    normalizeMp3: async ({ outputPath }) => {
      await writeFile(outputPath, `normalized:${basename(outputPath)}`, { flag: "wx" });
    },
    encodeAac: async ({ outputPath }) => {
      await writeFile(outputPath, `aac:${basename(outputPath)}`, { flag: "wx" });
    },
    mux: async ({ masterPath, outputPath }) => {
      await writeFile(outputPath, `mux:${basename(masterPath)}:${basename(outputPath)}`, {
        flag: "wx",
      });
    },
    probeMedia: async (path) => {
      if (path.includes("portrait")) {
        return path.endsWith("silent.mp4")
          ? validMasterMetadata("portrait")
          : validMuxedMetadata("portrait");
      }
      return path.endsWith("silent.mp4")
        ? validMasterMetadata("square")
        : validMuxedMetadata("square");
    },
    packetFingerprint: async (path, stream) => {
      const format = path.includes("portrait") ? "portrait" : "square";
      const candidate = MUSIC_ALTERNATIVES.find(({ id }) => path.includes(id))?.id ?? "master";
      return {
        packetCount: 10,
        sha256: fixtureSha256(stream === "video" ? `${format}-video` : `${candidate}-audio`),
        startTimeSeconds: 0,
        endTimeSeconds: TARGET_DURATION_SECONDS,
      };
    },
  },
});

const runOptions = (fixture: Fixture) => ({
  outputDirectory: fixture.outputDirectory,
  portraitMaster: fixture.portraitMaster,
  squareMaster: fixture.squareMaster,
  candidates: fixture.candidates,
  apiKey: "test-only-key",
});

const failedRunDirectories = async (root: string) =>
  (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.includes(".failed-"))
    .map((entry) => join(root, entry.name));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("music alternative definitions", () => {
  test("ships exactly four strongly named candidates and sixteen artifacts", () => {
    expect(MUSIC_ALTERNATIVES.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: "street-grid", title: "Street Grid" },
      { id: "pocket-library-funk", title: "Pocket Library Funk" },
      { id: "felt-cartography", title: "Felt Cartography" },
      { id: "magnetic-north", title: "Magnetic North" },
    ]);
    expect(expectedAlternativeArtifactNames(MUSIC_ALTERNATIVES)).toHaveLength(16);
    expect(
      expectedAlternativeArtifactNames(MUSIC_ALTERNATIVES).filter((path) => path.endsWith(".mp4")),
    ).toHaveLength(8);
  });

  test("keeps each prompt scene-aligned, instrumental, and stylistically distinct", async () => {
    const prompts = await Promise.all(
      MUSIC_ALTERNATIVES.map(async ({ promptPath }) => readFile(promptPath, "utf8")),
    );
    for (const prompt of prompts) {
      expect(prompt).toContain("72–75 seconds");
      expect(prompt).toContain("0:55.5–0:58.5");
      expect(prompt).toContain("original instrumental only");
      expect(prompt).toContain("No vocals, speech, whispers, chants, lyrics");
      expect(prompt).toContain("No samples, recognizable or pre-existing melodies");
    }
    expect(new Set(prompts).size).toBe(4);
    expect(prompts[0]).toContain("urban broken-beat");
    expect(prompts[1]).toContain("vintage library funk");
    expect(prompts[2]).toContain("chamber minimalism");
    expect(prompts[3]).toContain("analog electro");
  });
});

describe("media contracts", () => {
  test("accepts exact silent masters and muxed delivery media", () => {
    expect(() =>
      assertMasterMediaContract(validMasterMetadata("portrait"), "portrait"),
    ).not.toThrow();
    expect(() => assertMasterMediaContract(validMasterMetadata("square"), "square")).not.toThrow();
    expect(() =>
      assertMuxedMediaContract(validMuxedMetadata("portrait"), "portrait"),
    ).not.toThrow();
    expect(() => assertMuxedMediaContract(validMuxedMetadata("square"), "square")).not.toThrow();
  });

  test("rejects audio in a master and non-48k mono delivery audio", () => {
    expect(() => assertMasterMediaContract(validMuxedMetadata("portrait"), "portrait")).toThrow(
      "silent",
    );
    const invalid = validMuxedMetadata("square");
    invalid.streams[1] = { type: "audio", codec: "aac", sampleRate: 44_100, channels: 1 };
    expect(() => assertMuxedMediaContract(invalid, "square")).toThrow("48 kHz stereo AAC");
  });

  test("rejects retimed packet identity and truncated AAC packet coverage", () => {
    const complete = {
      packetCount: 1755,
      sha256: "same-payload-hash",
      startTimeSeconds: 0,
      endTimeSeconds: TARGET_DURATION_SECONDS,
    };
    expect(() =>
      assertSamePacketFingerprint(
        { ...complete, startTimeSeconds: 0.5 },
        complete,
        "retimed video",
      ),
    ).toThrow("packet identity changed");
    expect(() =>
      assertAudioPacketCoverage(
        { ...complete, endTimeSeconds: TARGET_DURATION_SECONDS - 1 },
        "truncated audio",
      ),
    ).toThrow("complete 58.5s timeline");
  });

  test("terminates a media subprocess when its timeout expires", async () => {
    const startedAt = Date.now();
    await expect(
      runBoundedMediaCommand(["/bin/sh", "-c", "trap '' TERM; while :; do :; done"], {
        timeoutMs: 25,
      }),
    ).rejects.toThrow("timed out");
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});

describe("immutable publication lifecycle", () => {
  test("rejects an unsupported generation platform during publication preflight", async () => {
    const root = await mkdtemp(join(tmpdir(), "mapvest-publication-platform-"));
    try {
      await expect(createMusicAlternativesPublication("linux").preflight(root)).rejects.toThrow(
        "supported only on macOS",
      );
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  const macOsTest = process.platform === "darwin" ? test : test.skip;
  macOsTest("Darwin RENAME_EXCL refuses an empty destination directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "mapvest-publication-exclusive-"));
    const staging = join(root, "staging");
    const destination = join(root, "destination");
    try {
      await defaultMusicAlternativesPublication.preflight(root);
      await Promise.all([mkdir(staging), mkdir(destination)]);
      await writeFile(join(staging, "paid-evidence.mp3"), "paid evidence");

      await expect(
        defaultMusicAlternativesPublication.publish(staging, destination),
      ).rejects.toThrow("already exists and is immutable");
      expect(await readdir(destination)).toEqual([]);
      expect(await readFile(join(staging, "paid-evidence.mp3"), "utf8")).toBe("paid evidence");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("generateMusicAlternatives", () => {
  test("dry-run makes no requests or writes and reports the four-request estimate", async () => {
    const fixture = await makeFixture();
    let requestCount = 0;
    const dependencies = fixtureDependencies(fixture, async () => {
      requestCount += 1;
      return responseWithAudio("unexpected");
    });

    try {
      const result = await generateMusicAlternatives(
        { ...runOptions(fixture), apiKey: undefined, dryRun: true },
        dependencies,
      );
      expect(result.mode).toBe("dry-run");
      expect(result.estimatedGenerationCostUsd).toBe(ESTIMATED_ALTERNATIVES_COST_USD);
      expect(requestCount).toBe(0);
      await expect(stat(fixture.outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await readdir(fixture.root)).some((name) => name.includes(".staging-"))).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("refuses an existing destination before fetching", async () => {
    const fixture = await makeFixture();
    await mkdir(fixture.outputDirectory);
    let requestCount = 0;
    const dependencies = fixtureDependencies(fixture, async () => {
      requestCount += 1;
      return responseWithAudio("unexpected");
    });

    try {
      await expect(generateMusicAlternatives(runOptions(fixture), dependencies)).rejects.toThrow(
        "already exists",
      );
      expect(requestCount).toBe(0);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects unsafe and duplicate candidate ids before fetching", async () => {
    const fixture = await makeFixture();
    let requestCount = 0;
    const dependencies = fixtureDependencies(fixture, async () => {
      requestCount += 1;
      return responseWithAudio("unexpected");
    });
    const unsafe = fixture.candidates.map((candidate, index) =>
      index === 0 ? { ...candidate, id: "../street-grid" } : candidate,
    );
    const duplicate = fixture.candidates.map((candidate, index) =>
      index === 1 ? { ...candidate, id: fixture.candidates[0]?.id ?? "street-grid" } : candidate,
    );

    try {
      await expect(
        generateMusicAlternatives({ ...runOptions(fixture), candidates: unsafe }, dependencies),
      ).rejects.toThrow("unsafe");
      await expect(
        generateMusicAlternatives({ ...runOptions(fixture), candidates: duplicate }, dependencies),
      ).rejects.toThrow("duplicate");
      expect(requestCount).toBe(0);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects paths outside the allowed root and symlink traversal before fetching", async () => {
    const fixture = await makeFixture();
    const realOutputParent = join(fixture.root, "real-output-parent");
    const linkedOutputParent = join(fixture.root, "linked-output-parent");
    const linkedMaster = join(fixture.root, "linked-portrait.mp4");
    await mkdir(realOutputParent);
    await symlink(realOutputParent, linkedOutputParent, "dir");
    await symlink(fixture.portraitMaster, linkedMaster, "file");
    let requestCount = 0;
    const dependencies = fixtureDependencies(fixture, async () => {
      requestCount += 1;
      return responseWithAudio("unexpected");
    });

    try {
      await expect(
        generateMusicAlternatives(
          { ...runOptions(fixture), outputDirectory: join(tmpdir(), "outside-audition") },
          dependencies,
        ),
      ).rejects.toThrow("under");
      await expect(
        generateMusicAlternatives(
          { ...runOptions(fixture), portraitMaster: linkedMaster },
          dependencies,
        ),
      ).rejects.toThrow("symbolic link");
      await expect(
        generateMusicAlternatives(
          { ...runOptions(fixture), outputDirectory: join(linkedOutputParent, "audition") },
          dependencies,
        ),
      ).rejects.toThrow("symbolic link");

      const linkedPrompt = fixture.candidates[0]?.promptPath;
      const promptTarget = fixture.candidates[1]?.promptPath;
      if (!linkedPrompt || !promptTarget) throw new Error("Expected prompt fixtures");
      await rm(linkedPrompt);
      await symlink(promptTarget, linkedPrompt, "file");
      await expect(generateMusicAlternatives(runOptions(fixture), dependencies)).rejects.toThrow(
        "symbolic link",
      );
      expect(requestCount).toBe(0);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("preflights the media toolchain before the first paid request", async () => {
    const fixture = await makeFixture();
    let requestCount = 0;
    const dependencies = fixtureDependencies(fixture, async () => {
      requestCount += 1;
      return responseWithAudio("unexpected");
    });
    dependencies.media.preflight = async () => {
      throw new Error("simulated missing AAC encoder");
    };

    try {
      await expect(generateMusicAlternatives(runOptions(fixture), dependencies)).rejects.toThrow(
        "missing AAC encoder",
      );
      expect(requestCount).toBe(0);
      expect((await readdir(fixture.root)).some((name) => name.endsWith(".lock"))).toBe(false);
      expect((await readdir(fixture.root)).some((name) => name.includes(".staging-"))).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects an unsupported publication platform before the first paid request", async () => {
    const fixture = await makeFixture();
    let requestCount = 0;
    const dependencies = fixtureDependencies(fixture, async () => {
      requestCount += 1;
      return responseWithAudio("unexpected");
    });
    dependencies.publication = createMusicAlternativesPublication("linux");

    try {
      await expect(generateMusicAlternatives(runOptions(fixture), dependencies)).rejects.toThrow(
        "supported only on macOS",
      );
      expect(requestCount).toBe(0);
      expect((await readdir(fixture.root)).some((name) => name.endsWith(".lock"))).toBe(false);
      expect((await readdir(fixture.root)).some((name) => name.includes(".staging-"))).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("an exclusive destination lock prevents a concurrent duplicate charge", async () => {
    const fixture = await makeFixture();
    const firstRequestStarted = deferred<void>();
    const releaseFirstRequest = deferred<void>();
    let requestCount = 0;
    const dependencies = fixtureDependencies(fixture, async (candidate) => {
      requestCount += 1;
      if (requestCount === 1) {
        firstRequestStarted.resolve();
        await releaseFirstRequest.promise;
      }
      return responseWithAudio(candidate.id);
    });

    try {
      const firstRun = generateMusicAlternatives(runOptions(fixture), dependencies);
      await firstRequestStarted.promise;
      await expect(generateMusicAlternatives(runOptions(fixture), dependencies)).rejects.toThrow(
        "destination is locked",
      );
      expect(requestCount).toBe(1);
      releaseFirstRequest.resolve();
      await firstRun;
      expect(requestCount).toBe(4);
      expect((await readdir(fixture.root)).some((name) => name.endsWith(".lock"))).toBe(false);
    } finally {
      releaseFirstRequest.resolve();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("reports a stale lock as inert escaped path data", async () => {
    const fixture = await makeFixture();
    const maliciousOutput = join(fixture.root, "published-$(touch nope)-\u001b[31m");
    const lockPath = join(fixture.root, ".published-$(touch nope)-\u001b[31m.lock");
    await mkdir(lockPath);
    let requestCount = 0;
    const dependencies = fixtureDependencies(fixture, async () => {
      requestCount += 1;
      return responseWithAudio("unexpected");
    });

    try {
      let failure: unknown;
      try {
        await generateMusicAlternatives(
          { ...runOptions(fixture), outputDirectory: maliciousOutput },
          dependencies,
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      const message = (failure as Error).message;
      expect(message).toContain(
        `Lock directory (inert JSON): ${JSON.stringify(await realpath(lockPath))}`,
      );
      expect(message).not.toContain("rm -f");
      expect(message).not.toContain("rmdir");
      expect(message).not.toContain("\u001b");
      expect(message).toContain("\\u001b");
      expect(requestCount).toBe(0);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("uses one sequential request per candidate and atomically publishes the exact set", async () => {
    const fixture = await makeFixture();
    const requestOrder: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const dependencies = fixtureDependencies(fixture, async (candidate) => {
      requestOrder.push(candidate.id);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return responseWithAudio(candidate.id);
    });

    try {
      const result = await generateMusicAlternatives(runOptions(fixture), dependencies);
      expect(result.mode).toBe("generated");
      expect(requestOrder).toEqual(fixture.candidates.map(({ id }) => id));
      expect(maxInFlight).toBe(1);
      expect((await readdir(fixture.outputDirectory)).sort()).toEqual(
        [
          ...expectedAlternativeArtifactNames(fixture.candidates),
          MUSIC_ALTERNATIVES_MANIFEST,
        ].sort(),
      );
      expect((await readdir(fixture.root)).some((name) => name.includes(".staging-"))).toBe(false);

      const manifest = JSON.parse(
        await readFile(join(fixture.outputDirectory, MUSIC_ALTERNATIVES_MANIFEST), "utf8"),
      ) as { artifacts: unknown[]; candidates: unknown[] };
      expect(manifest.artifacts).toHaveLength(16);
      expect(manifest.candidates).toHaveLength(4);
      await verifyMusicAlternatives(runOptions(fixture), dependencies);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("does not replace a destination created during generation", async () => {
    const fixture = await makeFixture();
    const dependencies = fixtureDependencies(fixture, async (candidate) =>
      responseWithAudio(candidate.id),
    );
    const fingerprint = dependencies.media.packetFingerprint;
    let raced = false;
    dependencies.media.packetFingerprint = async (path, stream, options) => {
      const value = await fingerprint(path, stream, options);
      if (!raced && stream === "audio" && path.endsWith("magnetic-north-square.mp4")) {
        raced = true;
        await mkdir(fixture.outputDirectory);
        await writeFile(join(fixture.outputDirectory, "external-owner.txt"), "do not replace");
      }
      return value;
    };

    try {
      await expect(generateMusicAlternatives(runOptions(fixture), dependencies)).rejects.toThrow(
        "already exists",
      );
      expect(await readFile(join(fixture.outputDirectory, "external-owner.txt"), "utf8")).toBe(
        "do not replace",
      );
      expect((await readdir(fixture.root)).some((name) => name.includes(".staging-"))).toBe(false);
      expect(await failedRunDirectories(fixture.root)).toHaveLength(1);
      expect((await readdir(fixture.root)).some((name) => name.endsWith(".lock"))).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("quarantines paid artifacts and leaves both masters untouched on later failure", async () => {
    const fixture = await makeFixture();
    const portraitBefore = await readFile(fixture.portraitMaster, "utf8");
    const squareBefore = await readFile(fixture.squareMaster, "utf8");
    let requestCount = 0;
    const dependencies = fixtureDependencies(fixture, async (_input) => {
      requestCount += 1;
      if (requestCount === 3) throw new Error("simulated paid generation failure");
      return responseWithAudio(String(_input));
    });

    try {
      let failure: unknown;
      try {
        await generateMusicAlternatives(runOptions(fixture), dependencies);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain("simulated paid generation failure");
      expect(requestCount).toBe(3);
      await expect(stat(fixture.outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await readdir(fixture.root)).some((name) => name.includes(".staging-"))).toBe(false);
      const failedDirectories = await failedRunDirectories(fixture.root);
      expect(failedDirectories).toHaveLength(1);
      const failedDirectory = failedDirectories[0];
      if (!failedDirectory) throw new Error("Expected one failed-run quarantine");
      const canonicalFailedDirectory = await realpath(failedDirectory);
      expect((failure as Error).message).toContain(JSON.stringify(canonicalFailedDirectory));
      expect(await readdir(failedDirectory)).toEqual(
        expect.arrayContaining([
          "street-grid.mp3",
          "street-grid.provenance.json",
          "pocket-library-funk.mp3",
          "pocket-library-funk.provenance.json",
        ]),
      );
      expect(await readFile(fixture.portraitMaster, "utf8")).toBe(portraitBefore);
      expect(await readFile(fixture.squareMaster, "utf8")).toBe(squareBefore);
      expect((await readdir(fixture.root)).some((name) => name.endsWith(".lock"))).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("cleans staging when the first paid request fails before a response is persisted", async () => {
    const fixture = await makeFixture();
    let requestCount = 0;
    const dependencies = fixtureDependencies(fixture, async () => {
      requestCount += 1;
      throw new Error("simulated first request failure");
    });

    try {
      await expect(generateMusicAlternatives(runOptions(fixture), dependencies)).rejects.toThrow(
        "simulated first request failure",
      );
      expect(requestCount).toBe(1);
      await expect(stat(fixture.outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await failedRunDirectories(fixture.root)).toEqual([]);
      const entries = await readdir(fixture.root);
      expect(entries.some((name) => name.includes(".staging-"))).toBe(false);
      expect(entries.some((name) => name.endsWith(".lock"))).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("SIGTERM waits for active media termination before cleanup and exit", async () => {
    const fixture = await makeFixture();
    const mediaStarted = deferred<void>();
    const handlers = new Map<"SIGINT" | "SIGTERM", () => void>();
    const exits: number[] = [];
    const reports: string[] = [];
    const dependencies = fixtureDependencies(fixture, async (candidate) =>
      responseWithAudio(candidate.id),
    );
    dependencies.media.normalizeMp3 = async ({ signal }) => {
      const activeCommand = runBoundedMediaCommand(
        ["/bin/sh", "-c", "trap '' TERM; while :; do :; done"],
        { timeoutMs: 5_000, signal },
      );
      await Bun.sleep(25);
      mediaStarted.resolve();
      await activeCommand;
    };
    dependencies.signals = {
      add: (signal, listener) => handlers.set(signal, listener),
      remove: (signal, listener) => {
        if (handlers.get(signal) === listener) handlers.delete(signal);
      },
      report: (message) => reports.push(message),
      exit: (code) => exits.push(code),
    };

    try {
      const run = generateMusicAlternatives(runOptions(fixture), dependencies);
      await mediaStarted.promise;
      handlers.get("SIGTERM")?.();
      await Bun.sleep(50);
      expect(exits).toEqual([]);
      await expect(run).rejects.toThrow(/cancelled|aborted/);
      const entries = await readdir(fixture.root);
      expect(entries.some((name) => name.includes(".staging-"))).toBe(false);
      expect(entries.some((name) => name.endsWith(".lock"))).toBe(false);
      const failedDirectories = await failedRunDirectories(fixture.root);
      expect(failedDirectories).toHaveLength(1);
      const failedDirectory = failedDirectories[0];
      if (!failedDirectory) throw new Error("Expected one failed-run quarantine");
      expect(reports).toContain(
        `Paid generation evidence was preserved at ${JSON.stringify(await realpath(failedDirectory))}.`,
      );
      expect(exits).toEqual([143]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("reports signal cleanup failure and recovery paths before exiting", async () => {
    const fixture = await makeFixture();
    const mediaStarted = deferred<void>();
    const handlers = new Map<"SIGINT" | "SIGTERM", () => void>();
    const events: string[] = [];
    const reports: string[] = [];
    const lockPath = join(fixture.root, ".published-audition.lock");
    const dependencies = fixtureDependencies(fixture, async (candidate) =>
      responseWithAudio(candidate.id),
    );
    dependencies.media.normalizeMp3 = async ({ signal }) => {
      mediaStarted.resolve();
      await new Promise<never>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("media aborted")), { once: true });
      });
    };
    dependencies.signals = {
      add: (signal, listener) => handlers.set(signal, listener),
      remove: (signal, listener) => {
        if (handlers.get(signal) === listener) handlers.delete(signal);
      },
      report: (message) => {
        events.push("report");
        reports.push(message);
      },
      exit: (code) => {
        events.push(`exit:${code}`);
      },
    };

    try {
      const run = generateMusicAlternatives(runOptions(fixture), dependencies);
      await mediaStarted.promise;
      await writeFile(
        join(lockPath, "owner.json"),
        `${JSON.stringify({ token: "changed-by-external-owner" })}\n`,
      );
      handlers.get("SIGTERM")?.();

      await expect(run).rejects.toThrow("cleanup was incomplete");
      expect(events).toEqual(["report", "report", "exit:143"]);
      expect(reports).toHaveLength(2);
      const failedDirectories = await failedRunDirectories(fixture.root);
      expect(failedDirectories).toHaveLength(1);
      const failedDirectory = failedDirectories[0];
      if (!failedDirectory) throw new Error("Expected one failed-run quarantine");
      expect(reports).toContain(
        `Paid generation evidence was preserved at ${JSON.stringify(await realpath(failedDirectory))}.`,
      );
      const canonicalLockPath = await realpath(lockPath);
      expect(reports.some((message) => message.includes(canonicalLockPath))).toBe(true);
      expect(
        reports.some((message) => message.includes("inspect and remove only these owned paths")),
      ).toBe(true);
      expect((await stat(lockPath)).isDirectory()).toBe(true);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("publishes nothing when complete-set media validation fails", async () => {
    const fixture = await makeFixture();
    let requestCount = 0;
    const dependencies = fixtureDependencies(fixture, async (candidate) => {
      requestCount += 1;
      return responseWithAudio(candidate.id);
    });
    const fingerprint = dependencies.media.packetFingerprint;
    dependencies.media.packetFingerprint = async (path, stream) => {
      const value = await fingerprint(path, stream);
      if (stream === "video" && path.endsWith("magnetic-north-square.mp4")) {
        return { ...value, sha256: "mismatched-square-video" };
      }
      return value;
    };

    try {
      await expect(generateMusicAlternatives(runOptions(fixture), dependencies)).rejects.toThrow(
        "packet identity changed",
      );
      expect(requestCount).toBe(4);
      await expect(stat(fixture.outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await readdir(fixture.root)).some((name) => name.includes(".staging-"))).toBe(false);
      expect(await failedRunDirectories(fixture.root)).toHaveLength(1);
      expect((await readdir(fixture.root)).some((name) => name.endsWith(".lock"))).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("publishes nothing when AAC packets do not cover the full timeline", async () => {
    const fixture = await makeFixture();
    let requestCount = 0;
    const dependencies = fixtureDependencies(fixture, async (candidate) => {
      requestCount += 1;
      return responseWithAudio(candidate.id);
    });
    const fingerprint = dependencies.media.packetFingerprint;
    dependencies.media.packetFingerprint = async (path, stream, options) => {
      const value = await fingerprint(path, stream, options);
      if (stream === "audio" && path.endsWith("street-grid-portrait.mp4")) {
        return { ...value, endTimeSeconds: 40 };
      }
      return value;
    };

    try {
      await expect(generateMusicAlternatives(runOptions(fixture), dependencies)).rejects.toThrow(
        "complete 58.5s timeline",
      );
      expect(requestCount).toBe(4);
      await expect(stat(fixture.outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await readdir(fixture.root)).some((name) => name.includes(".staging-"))).toBe(false);
      expect(await failedRunDirectories(fixture.root)).toHaveLength(1);
      expect((await readdir(fixture.root)).some((name) => name.endsWith(".lock"))).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("verification rejects whole-file hash drift", async () => {
    const fixture = await makeFixture();
    const dependencies = fixtureDependencies(fixture, async (_input) =>
      responseWithAudio(String(_input)),
    );

    try {
      await generateMusicAlternatives(runOptions(fixture), dependencies);
      await writeFile(join(fixture.outputDirectory, "street-grid-portrait.mp4"), "tampered");
      await expect(verifyMusicAlternatives(runOptions(fixture), dependencies)).rejects.toThrow(
        "hash",
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("verification rejects a manifest that relabels an artifact", async () => {
    const fixture = await makeFixture();
    const dependencies = fixtureDependencies(fixture, async (candidate) =>
      responseWithAudio(candidate.id),
    );

    try {
      await generateMusicAlternatives(runOptions(fixture), dependencies);
      const manifestPath = join(fixture.outputDirectory, MUSIC_ALTERNATIVES_MANIFEST);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        artifacts: Array<{ role: string }>;
      };
      if (!manifest.artifacts[0]) throw new Error("Expected one manifest artifact");
      manifest.artifacts[0].role = "square-video";
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      await expect(verifyMusicAlternatives(runOptions(fixture), dependencies)).rejects.toThrow(
        "role or candidate identity",
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("verification rejects a malformed nested packet fingerprint", async () => {
    const fixture = await makeFixture();
    const dependencies = fixtureDependencies(fixture, async (candidate) =>
      responseWithAudio(candidate.id),
    );

    try {
      await generateMusicAlternatives(runOptions(fixture), dependencies);
      const manifestPath = join(fixture.outputDirectory, MUSIC_ALTERNATIVES_MANIFEST);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        candidates: Array<{ portraitVideoPackets: Record<string, unknown> }>;
      };
      const candidate = manifest.candidates[0];
      if (!candidate) throw new Error("Expected one manifest candidate");
      candidate.portraitVideoPackets.packetCount = "ten";
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      await expect(verifyMusicAlternatives(runOptions(fixture), dependencies)).rejects.toThrow(
        "invalid nested schema",
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("returns the completed result when SIGTERM arrives after immutable publication", async () => {
    const fixture = await makeFixture();
    const handlers = new Map<"SIGINT" | "SIGTERM", () => void>();
    const exits: number[] = [];
    const reports: string[] = [];
    const dependencies = fixtureDependencies(fixture, async (candidate) =>
      responseWithAudio(candidate.id),
    );
    const publish = dependencies.publication.publish;
    dependencies.publication.publish = async (stagingDirectory, outputDirectory) => {
      await publish(stagingDirectory, outputDirectory);
      handlers.get("SIGTERM")?.();
    };
    dependencies.signals = {
      add: (signal, listener) => handlers.set(signal, listener),
      remove: (signal, listener) => {
        if (handlers.get(signal) === listener) handlers.delete(signal);
      },
      report: (message) => reports.push(message),
      exit: (code) => exits.push(code),
    };

    try {
      const result = await generateMusicAlternatives(runOptions(fixture), dependencies);
      expect(result.mode).toBe("generated");
      expect(exits).toEqual([]);
      expect(reports).toContain(
        `Music alternatives were published before SIGTERM: ${JSON.stringify(await realpath(fixture.outputDirectory))}`,
      );
      expect((await readdir(fixture.outputDirectory)).sort()).toEqual(
        [
          ...expectedAlternativeArtifactNames(fixture.candidates),
          MUSIC_ALTERNATIVES_MANIFEST,
        ].sort(),
      );
      expect(await failedRunDirectories(fixture.root)).toEqual([]);
      const entries = await readdir(fixture.root);
      expect(entries.some((name) => name.includes(".staging-"))).toBe(false);
      expect(entries.some((name) => name.endsWith(".lock"))).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
