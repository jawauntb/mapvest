import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { LyriaInteractionContent, LyriaInteractionResponse } from "@mapvest/core/schemas";
import {
  type MusicAlternativeMediaTools,
  TARGET_DURATION_SECONDS,
  assertAudioPacketCoverage,
  assertMasterMediaContract,
  assertMuxedMediaContract,
  assertNormalizedMp3Contract,
  assertSamePacketFingerprint,
  defaultMusicAlternativeMediaTools,
  sha256File,
} from "./music-alternative-media.js";
import {
  type ArtifactDigest,
  type ArtifactRole,
  type CandidateManifest,
  type MasterSnapshot,
  type MusicAlternativesManifest,
  MusicAlternativesManifestSchema,
} from "./music-alternatives-contract.js";
import {
  type DestinationLock,
  type MusicAlternativesPublication,
  acquireDestinationLock,
  assertDestinationAvailable,
  defaultMusicAlternativesPublication,
  inertPath,
  quarantineFailedRun,
  releaseDestinationLock,
} from "./music-alternatives-lifecycle.js";
import { requestLyria } from "./music-generation.js";

const ROOT = join(import.meta.dir, "..");
const MODEL = "lyria-3-pro-preview";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const COST_PER_CANDIDATE_USD = 0.08;
const PROVENANCE_DURATION_TOLERANCE_SECONDS = 0.001;
const DEFAULT_ALLOWED_USER_ROOT = "/Users/jawaun";
const DEFAULT_PROMPT_ROOT = join(ROOT, "music", "alternatives");
const signalProcess = process as unknown as {
  on: (signal: "SIGINT" | "SIGTERM", listener: () => void) => void;
  off: (signal: "SIGINT" | "SIGTERM", listener: () => void) => void;
};

export const MUSIC_ALTERNATIVES_MANIFEST = "music-alternatives-manifest.json";

export type MusicAlternativeDefinition = {
  id: string;
  title: string;
  promptPath: string;
};

export const MUSIC_ALTERNATIVES: readonly MusicAlternativeDefinition[] = [
  {
    id: "street-grid",
    title: "Street Grid",
    promptPath: join(ROOT, "music", "alternatives", "street-grid.prompt.txt"),
  },
  {
    id: "pocket-library-funk",
    title: "Pocket Library Funk",
    promptPath: join(ROOT, "music", "alternatives", "pocket-library-funk.prompt.txt"),
  },
  {
    id: "felt-cartography",
    title: "Felt Cartography",
    promptPath: join(ROOT, "music", "alternatives", "felt-cartography.prompt.txt"),
  },
  {
    id: "magnetic-north",
    title: "Magnetic North",
    promptPath: join(ROOT, "music", "alternatives", "magnetic-north.prompt.txt"),
  },
];

export const ESTIMATED_ALTERNATIVES_COST_USD = Number(
  (MUSIC_ALTERNATIVES.length * COST_PER_CANDIDATE_USD).toFixed(2),
);

export type MusicAlternativesDependencies = {
  requestLyria: (
    candidate: MusicAlternativeDefinition,
    prompt: string,
    apiKey: string,
    signal: AbortSignal,
  ) => Promise<LyriaInteractionResponse>;
  media: MusicAlternativeMediaTools;
  publication: MusicAlternativesPublication;
  now: () => Date;
  pathPolicy: {
    allowedUserRoot: string;
    promptRoot: string;
  };
  signals: {
    add: (signal: "SIGINT" | "SIGTERM", listener: () => void) => void;
    remove: (signal: "SIGINT" | "SIGTERM", listener: () => void) => void;
    report: (message: string) => void;
    exit: (code: number) => void;
  };
};

export type GenerateMusicAlternativesOptions = {
  outputDirectory: string;
  portraitMaster: string;
  squareMaster: string;
  candidates?: readonly MusicAlternativeDefinition[];
  apiKey?: string;
  dryRun?: boolean;
};

type DryRunResult = {
  mode: "dry-run";
  outputDirectory: string;
  estimatedGenerationCostUsd: number;
  targetDurationSeconds: number;
  candidates: Array<{
    id: string;
    title: string;
    promptPath: string;
    artifacts: string[];
  }>;
  masters: MusicAlternativesManifest["masters"];
};

type GeneratedResult = {
  mode: "generated";
  outputDirectory: string;
  estimatedGenerationCostUsd: number;
  manifest: MusicAlternativesManifest;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const defaultDependencies: MusicAlternativesDependencies = {
  requestLyria: async (_candidate, prompt, apiKey, signal) =>
    requestLyria({ endpoint: ENDPOINT, apiKey, model: MODEL, prompt, signal }),
  media: defaultMusicAlternativeMediaTools,
  publication: defaultMusicAlternativesPublication,
  now: () => new Date(),
  pathPolicy: {
    allowedUserRoot: DEFAULT_ALLOWED_USER_ROOT,
    promptRoot: DEFAULT_PROMPT_ROOT,
  },
  signals: {
    add: (signal, listener) => {
      signalProcess.on(signal, listener);
    },
    remove: (signal, listener) => {
      signalProcess.off(signal, listener);
    },
    report: (message) => console.error(message),
    exit: (code) => process.exit(code),
  },
};

const digestFile = async (
  root: string,
  path: string,
  role: ArtifactRole,
  candidateId: string,
): Promise<ArtifactDigest> => {
  const absolutePath = join(root, path);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) throw new Error(`Expected a regular artifact file: ${path}`);
  return {
    path,
    role,
    candidateId,
    bytes: metadata.size,
    sha256: await sha256File(absolutePath),
  };
};

const assertAbsolutePath = (path: string, label: string) => {
  if (!path || !isAbsolute(path)) throw new Error(`${label} must be an explicit absolute path.`);
};

const isContainedPath = (root: string, path: string) => {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
};

const assertNoSymlinkComponents = async (trustedRoot: string, target: string, label: string) => {
  const pathFromRoot = relative(trustedRoot, target);
  if (!isContainedPath(trustedRoot, target)) {
    throw new Error(`${label} must remain under ${trustedRoot}.`);
  }
  let current = trustedRoot;
  for (const component of pathFromRoot.split("/").filter(Boolean)) {
    current = join(current, component);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) {
      throw new Error(`${label} may not traverse a symbolic link: ${current}`);
    }
  }
};

const canonicalizeExistingFile = async (path: string, trustedRoot: string, label: string) => {
  const lexicalRoot = resolve(trustedRoot);
  const lexicalPath = resolve(path);
  if (!isContainedPath(lexicalRoot, lexicalPath)) {
    throw new Error(`${label} must remain under ${trustedRoot}.`);
  }
  await assertNoSymlinkComponents(lexicalRoot, lexicalPath, label);
  const metadata = await lstat(lexicalPath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a regular, non-symlink file: ${path}`);
  }
  const [canonicalRoot, canonicalPath] = await Promise.all([
    realpath(lexicalRoot),
    realpath(lexicalPath),
  ]);
  if (!isContainedPath(canonicalRoot, canonicalPath)) {
    throw new Error(`${label} resolves outside ${trustedRoot}.`);
  }
  return canonicalPath;
};

const canonicalizeOutputPath = async (
  outputDirectory: string,
  trustedRoot: string,
  mode: "generate" | "verify",
) => {
  const lexicalRoot = resolve(trustedRoot);
  const lexicalOutput = resolve(outputDirectory);
  const lexicalParent = dirname(lexicalOutput);
  if (!isContainedPath(lexicalRoot, lexicalOutput) || lexicalOutput === lexicalRoot) {
    throw new Error(`Output directory must name a child directory under ${trustedRoot}.`);
  }
  await assertNoSymlinkComponents(lexicalRoot, lexicalParent, "Output directory parent");
  const [canonicalRoot, canonicalParent] = await Promise.all([
    realpath(lexicalRoot),
    realpath(lexicalParent),
  ]);
  if (!isContainedPath(canonicalRoot, canonicalParent)) {
    throw new Error(`Output directory resolves outside ${trustedRoot}.`);
  }
  const canonicalOutput = join(canonicalParent, basename(lexicalOutput));
  if (mode === "verify") {
    await assertNoSymlinkComponents(canonicalRoot, canonicalOutput, "Output directory");
    const metadata = await lstat(canonicalOutput);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("Output directory must be a regular, non-symlink directory.");
    }
  }
  return canonicalOutput;
};

const assertCandidateDefinitions = (candidates: readonly MusicAlternativeDefinition[]) => {
  if (candidates.length !== 4) throw new Error("Exactly four music alternatives are required.");
  const ids = new Set<string>();
  const titles = new Set<string>();
  for (const candidate of candidates) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.id)) {
      throw new Error(`Candidate id is unsafe: ${JSON.stringify(candidate.id)}.`);
    }
    if (ids.has(candidate.id)) {
      throw new Error(`Candidate id is duplicate: ${JSON.stringify(candidate.id)}.`);
    }
    if (!candidate.title.trim()) throw new Error(`Candidate ${candidate.id} has an empty title.`);
    if (titles.has(candidate.title)) {
      throw new Error(`Candidate title is duplicate: ${JSON.stringify(candidate.title)}.`);
    }
    ids.add(candidate.id);
    titles.add(candidate.title);
    assertAbsolutePath(candidate.promptPath, `Prompt path for ${candidate.id}`);
  }
};

const candidateArtifactNames = (candidate: MusicAlternativeDefinition) => ({
  audio: `${candidate.id}.mp3`,
  provenance: `${candidate.id}.provenance.json`,
  portraitVideo: `${candidate.id}-portrait.mp4`,
  squareVideo: `${candidate.id}-square.mp4`,
});

export const expectedAlternativeArtifactNames = (
  candidates: readonly MusicAlternativeDefinition[] = MUSIC_ALTERNATIVES,
) =>
  candidates.flatMap((candidate) => {
    const names = candidateArtifactNames(candidate);
    return [names.audio, names.provenance, names.portraitVideo, names.squareVideo];
  });

const canonicalizeInputs = async (
  options: Pick<
    GenerateMusicAlternativesOptions,
    "outputDirectory" | "portraitMaster" | "squareMaster"
  >,
  candidates: readonly MusicAlternativeDefinition[],
  dependencies: MusicAlternativesDependencies,
  mode: "generate" | "verify",
) => {
  const outputDirectory = await canonicalizeOutputPath(
    options.outputDirectory,
    dependencies.pathPolicy.allowedUserRoot,
    mode,
  );
  const [portraitMaster, squareMaster] = await Promise.all([
    canonicalizeExistingFile(
      options.portraitMaster,
      dependencies.pathPolicy.allowedUserRoot,
      "Portrait master",
    ),
    canonicalizeExistingFile(
      options.squareMaster,
      dependencies.pathPolicy.allowedUserRoot,
      "Square master",
    ),
  ]);
  const canonicalCandidates = await Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      promptPath: await canonicalizeExistingFile(
        candidate.promptPath,
        dependencies.pathPolicy.promptRoot,
        `Prompt for ${candidate.id}`,
      ),
    })),
  );
  return { outputDirectory, portraitMaster, squareMaster, candidates: canonicalCandidates };
};

const readPrompts = async (candidates: readonly MusicAlternativeDefinition[]) => {
  const prompts = new Map<string, { text: string; sha256: string }>();
  for (const candidate of candidates) {
    const text = (await readFile(candidate.promptPath, "utf8")).trim();
    if (!text) throw new Error(`Prompt is empty: ${candidate.promptPath}`);
    prompts.set(candidate.id, {
      text,
      sha256: createHash("sha256").update(text).digest("hex"),
    });
  }
  return prompts;
};

const generationAbortError = () => {
  const error = new Error("Music alternatives generation was cancelled.");
  error.name = "AbortError";
  return error;
};

const abortable = async <T>(work: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) throw generationAbortError();
  let rejectAbort: ((error: Error) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    rejectAbort?.(generationAbortError());
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
};

const assertNotCancelled = (signal: AbortSignal) => {
  if (signal.aborted) throw generationAbortError();
};

const inspectMaster = async (
  path: string,
  format: "portrait" | "square",
  media: MusicAlternativeMediaTools,
  signal?: AbortSignal,
): Promise<MasterSnapshot> => {
  const fileMetadata = await lstat(path);
  if (fileMetadata.isSymbolicLink() || !fileMetadata.isFile()) {
    throw new Error(`${format} master is not a regular, non-symlink file: ${path}`);
  }
  const [sha256, probed, videoPackets] = await Promise.all([
    sha256File(path),
    media.probeMedia(path, { signal }),
    media.packetFingerprint(path, "video", { signal }),
  ]);
  assertMasterMediaContract(probed, format);
  return { path, bytes: fileMetadata.size, sha256, media: probed, videoPackets };
};

const inspectMasters = async (
  options: Pick<GenerateMusicAlternativesOptions, "portraitMaster" | "squareMaster">,
  media: MusicAlternativeMediaTools,
  signal?: AbortSignal,
): Promise<MusicAlternativesManifest["masters"]> => {
  const [portrait, square] = await Promise.all([
    inspectMaster(options.portraitMaster, "portrait", media, signal),
    inspectMaster(options.squareMaster, "square", media, signal),
  ]);
  return { portrait, square };
};

const assertMastersUnchanged = async (
  expected: MusicAlternativesManifest["masters"],
  media: MusicAlternativeMediaTools,
  signal?: AbortSignal,
) => {
  const actual = await inspectMasters(
    { portraitMaster: expected.portrait.path, squareMaster: expected.square.path },
    media,
    signal,
  );
  for (const format of ["portrait", "square"] as const) {
    if (
      actual[format].sha256 !== expected[format].sha256 ||
      actual[format].bytes !== expected[format].bytes
    ) {
      throw new Error(`${format} silent master hash changed during the audition run.`);
    }
    assertSamePacketFingerprint(
      actual[format].videoPackets,
      expected[format].videoPackets,
      `${format} silent master video`,
    );
  }
};

const findAudio = (response: LyriaInteractionResponse): LyriaInteractionContent | undefined => {
  for (const step of response.steps) {
    const content = step.content ?? step.model_output?.content ?? [];
    const audio = content.find((item) => item.type === "audio" && item.data);
    if (audio) return audio;
  }
  return undefined;
};

const generateCandidate = async (
  stagingDirectory: string,
  candidate: MusicAlternativeDefinition,
  prompt: { text: string; sha256: string },
  options: Required<Pick<GenerateMusicAlternativesOptions, "apiKey">> & {
    portraitMaster: string;
    squareMaster: string;
  },
  dependencies: MusicAlternativesDependencies,
  onPaidResponsePersisted: () => void,
  signal: AbortSignal,
) => {
  const names = candidateArtifactNames(candidate);
  const audioPath = join(stagingDirectory, names.audio);
  const provenancePath = join(stagingDirectory, names.provenance);
  const sourcePath = join(stagingDirectory, `.${candidate.id}-source-${randomUUID()}`);
  const aacPath = join(stagingDirectory, `.${candidate.id}-aac-${randomUUID()}.m4a`);
  let paidResponsePersisted = false;
  let candidateCompleted = false;

  try {
    assertNotCancelled(signal);
    const response = await abortable(
      dependencies.requestLyria(candidate, prompt.text, options.apiKey, signal),
      signal,
    );
    const audio = findAudio(response);
    const mimeType = audio?.mime_type ?? audio?.mimeType;
    if (!audio?.data || !mimeType?.startsWith("audio/")) {
      throw new Error(`Lyria returned no supported audio for ${candidate.title}.`);
    }

    const sourceBytes = Buffer.from(audio.data, "base64");
    if (sourceBytes.length === 0)
      throw new Error(`Lyria returned empty audio for ${candidate.title}.`);
    await writeFile(sourcePath, sourceBytes, { flag: "wx" });
    paidResponsePersisted = true;
    onPaidResponsePersisted();

    const sourceMetadata = await dependencies.media.probeAudio(sourcePath, { signal });
    if (sourceMetadata.durationSeconds < TARGET_DURATION_SECONDS) {
      throw new Error(
        `${candidate.title} is ${sourceMetadata.durationSeconds.toFixed(1)}s; expected at least ${TARGET_DURATION_SECONDS}s. No retry was attempted.`,
      );
    }

    await dependencies.media.normalizeMp3({ sourcePath, outputPath: audioPath, signal });
    const normalizedMetadata = await dependencies.media.probeAudio(audioPath, { signal });
    assertNormalizedMp3Contract(normalizedMetadata, `${candidate.title} normalized audio`);

    const outputSha256 = await sha256File(audioPath);
    const provenance = {
      schemaVersion: 1,
      generatedAt: dependencies.now().toISOString(),
      candidate: { id: candidate.id, title: candidate.title },
      model: MODEL,
      endpoint: "/v1beta/interactions",
      store: false,
      promptPath: `music/alternatives/${basename(candidate.promptPath)}`,
      promptSha256: prompt.sha256,
      sourceMimeType: mimeType,
      sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
      sourceDurationSeconds: Number(sourceMetadata.durationSeconds.toFixed(3)),
      outputPath: names.audio,
      outputSha256,
      outputDurationSeconds: Number(normalizedMetadata.durationSeconds.toFixed(3)),
      codec: normalizedMetadata.codec,
      sampleRate: normalizedMetadata.sampleRate,
      channels: normalizedMetadata.channels,
      synthId: true,
      instrumentalOnlyRequested: true,
      estimatedGenerationCostUsd: COST_PER_CANDIDATE_USD,
    };
    await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, {
      flag: "wx",
    });

    await dependencies.media.encodeAac({ inputPath: audioPath, outputPath: aacPath, signal });
    await dependencies.media.mux({
      masterPath: options.portraitMaster,
      audioPath: aacPath,
      outputPath: join(stagingDirectory, names.portraitVideo),
      signal,
    });
    await dependencies.media.mux({
      masterPath: options.squareMaster,
      audioPath: aacPath,
      outputPath: join(stagingDirectory, names.squareVideo),
      signal,
    });
    candidateCompleted = true;
  } finally {
    const removals = [rm(aacPath, { force: true })];
    if (candidateCompleted || !paidResponsePersisted) {
      removals.push(rm(sourcePath, { force: true }));
    }
    await Promise.all(removals);
  }
};

const assertExactFileSet = async (directory: string, expectedNames: readonly string[]) => {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) {
    throw new Error("Music alternatives output may contain regular files only.");
  }
  const actual = entries.map(({ name }) => name).sort();
  const expected = [...expectedNames].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Music alternatives artifact set is incomplete or contains extras. Expected ${expected.join(", ")}; received ${actual.join(", ")}.`,
    );
  }
};

const validateCandidateMedia = async (
  directory: string,
  candidate: MusicAlternativeDefinition,
  prompt: { text: string; sha256: string },
  masters: MusicAlternativesManifest["masters"],
  media: MusicAlternativeMediaTools,
  signal?: AbortSignal,
): Promise<CandidateManifest> => {
  const names = candidateArtifactNames(candidate);
  const audioPath = join(directory, names.audio);
  const portraitPath = join(directory, names.portraitVideo);
  const squarePath = join(directory, names.squareVideo);
  const [audioMetadata, portraitMedia, squareMedia, portraitVideoPackets, squareVideoPackets] =
    await Promise.all([
      media.probeAudio(audioPath, { signal }),
      media.probeMedia(portraitPath, { signal }),
      media.probeMedia(squarePath, { signal }),
      media.packetFingerprint(portraitPath, "video", { signal }),
      media.packetFingerprint(squarePath, "video", { signal }),
    ]);
  assertNormalizedMp3Contract(audioMetadata, `${candidate.title} audio`);
  assertMuxedMediaContract(portraitMedia, "portrait");
  assertMuxedMediaContract(squareMedia, "square");
  assertSamePacketFingerprint(
    portraitVideoPackets,
    masters.portrait.videoPackets,
    `${candidate.title} portrait video`,
  );
  assertSamePacketFingerprint(
    squareVideoPackets,
    masters.square.videoPackets,
    `${candidate.title} square video`,
  );

  const [portraitAudioPackets, squareAudioPackets] = await Promise.all([
    media.packetFingerprint(portraitPath, "audio", { signal }),
    media.packetFingerprint(squarePath, "audio", { signal }),
  ]);
  assertAudioPacketCoverage(portraitAudioPackets, `${candidate.title} portrait audio`);
  assertAudioPacketCoverage(squareAudioPackets, `${candidate.title} square audio`);
  assertSamePacketFingerprint(
    portraitAudioPackets,
    squareAudioPackets,
    `${candidate.title} portrait/square audio`,
  );

  const provenanceRaw = JSON.parse(
    await readFile(join(directory, names.provenance), "utf8"),
  ) as unknown;
  if (!isRecord(provenanceRaw) || !isRecord(provenanceRaw.candidate)) {
    throw new Error(`${candidate.title} provenance must be a JSON object.`);
  }
  const expectedPromptPath = `music/alternatives/${basename(candidate.promptPath)}`;
  if (
    provenanceRaw.schemaVersion !== 1 ||
    !isIsoTimestamp(provenanceRaw.generatedAt) ||
    provenanceRaw.candidate.id !== candidate.id ||
    provenanceRaw.candidate.title !== candidate.title ||
    provenanceRaw.model !== MODEL ||
    provenanceRaw.endpoint !== "/v1beta/interactions" ||
    provenanceRaw.store !== false ||
    provenanceRaw.promptPath !== expectedPromptPath ||
    provenanceRaw.promptSha256 !== prompt.sha256 ||
    typeof provenanceRaw.sourceMimeType !== "string" ||
    !provenanceRaw.sourceMimeType.startsWith("audio/") ||
    !isSha256(provenanceRaw.sourceSha256) ||
    provenanceRaw.outputPath !== names.audio ||
    !isSha256(provenanceRaw.outputSha256) ||
    provenanceRaw.codec !== audioMetadata.codec ||
    provenanceRaw.sampleRate !== audioMetadata.sampleRate ||
    provenanceRaw.channels !== audioMetadata.channels ||
    provenanceRaw.synthId !== true ||
    provenanceRaw.instrumentalOnlyRequested !== true ||
    provenanceRaw.estimatedGenerationCostUsd !== COST_PER_CANDIDATE_USD
  ) {
    throw new Error(
      `${candidate.title} provenance does not match its media, prompt, and identity.`,
    );
  }
  const sourceDuration = Number(provenanceRaw.sourceDurationSeconds);
  if (!Number.isFinite(sourceDuration) || sourceDuration < TARGET_DURATION_SECONDS) {
    throw new Error(`${candidate.title} provenance source duration is invalid.`);
  }
  const outputDuration = Number(provenanceRaw.outputDurationSeconds);
  if (
    Math.abs(outputDuration - audioMetadata.durationSeconds) > PROVENANCE_DURATION_TOLERANCE_SECONDS
  ) {
    throw new Error(`${candidate.title} provenance duration does not match its MP3.`);
  }
  const audioSha256 = await sha256File(audioPath);
  if (provenanceRaw.outputSha256 !== audioSha256) {
    throw new Error(`${candidate.title} MP3 hash drifted from its provenance.`);
  }

  return {
    id: candidate.id,
    title: candidate.title,
    promptPath: expectedPromptPath,
    promptSha256: prompt.sha256,
    audioPath: names.audio,
    provenancePath: names.provenance,
    portraitVideoPath: names.portraitVideo,
    squareVideoPath: names.squareVideo,
    portraitVideoPackets,
    squareVideoPackets,
    audioPackets: portraitAudioPackets,
  };
};

const buildManifest = async (
  directory: string,
  candidates: readonly MusicAlternativeDefinition[],
  prompts: Map<string, { text: string; sha256: string }>,
  masters: MusicAlternativesManifest["masters"],
  dependencies: MusicAlternativesDependencies,
  signal?: AbortSignal,
): Promise<MusicAlternativesManifest> => {
  await assertExactFileSet(directory, expectedAlternativeArtifactNames(candidates));
  await assertMastersUnchanged(masters, dependencies.media, signal);

  const candidateEntries: CandidateManifest[] = [];
  const artifacts: ArtifactDigest[] = [];
  for (const candidate of candidates) {
    const prompt = prompts.get(candidate.id);
    if (!prompt) throw new Error(`Missing prompt for ${candidate.title}.`);
    candidateEntries.push(
      await validateCandidateMedia(
        directory,
        candidate,
        prompt,
        masters,
        dependencies.media,
        signal,
      ),
    );
    const names = candidateArtifactNames(candidate);
    artifacts.push(
      await digestFile(directory, names.audio, "audio", candidate.id),
      await digestFile(directory, names.provenance, "provenance", candidate.id),
      await digestFile(directory, names.portraitVideo, "portrait-video", candidate.id),
      await digestFile(directory, names.squareVideo, "square-video", candidate.id),
    );
  }

  return {
    schemaVersion: 1,
    generatedAt: dependencies.now().toISOString(),
    model: MODEL,
    targetDurationSeconds: TARGET_DURATION_SECONDS,
    estimatedGenerationCostUsd: ESTIMATED_ALTERNATIVES_COST_USD,
    masters,
    candidates: candidateEntries,
    artifacts,
  };
};

const parseManifest = async (directory: string): Promise<MusicAlternativesManifest> => {
  const raw = JSON.parse(
    await readFile(join(directory, MUSIC_ALTERNATIVES_MANIFEST), "utf8"),
  ) as unknown;
  const parsed = MusicAlternativesManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Music alternatives manifest has an invalid nested schema.", {
      cause: parsed.error,
    });
  }
  return parsed.data;
};

const validateManifest = async (
  directory: string,
  manifest: MusicAlternativesManifest,
  candidates: readonly MusicAlternativeDefinition[],
  prompts: Map<string, { text: string; sha256: string }>,
  expectedMasters: MusicAlternativesManifest["masters"],
  media: MusicAlternativeMediaTools,
  signal?: AbortSignal,
) => {
  await assertExactFileSet(directory, [
    ...expectedAlternativeArtifactNames(candidates),
    MUSIC_ALTERNATIVES_MANIFEST,
  ]);
  if (
    manifest.model !== MODEL ||
    !isIsoTimestamp(manifest.generatedAt) ||
    manifest.targetDurationSeconds !== TARGET_DURATION_SECONDS ||
    manifest.estimatedGenerationCostUsd !== ESTIMATED_ALTERNATIVES_COST_USD ||
    manifest.candidates.length !== candidates.length ||
    manifest.artifacts.length !== expectedAlternativeArtifactNames(candidates).length
  ) {
    throw new Error("Music alternatives manifest has an incomplete contract.");
  }
  const expectedIds = candidates.map(({ id }) => id);
  if (JSON.stringify(manifest.candidates.map(({ id }) => id)) !== JSON.stringify(expectedIds)) {
    throw new Error("Music alternatives manifest candidate order or identity changed.");
  }
  if (JSON.stringify(manifest.masters) !== JSON.stringify(expectedMasters)) {
    throw new Error("Music alternatives manifest references different silent masters.");
  }
  await assertMastersUnchanged(expectedMasters, media, signal);

  const expectedArtifactNames = expectedAlternativeArtifactNames(candidates).sort();
  const manifestArtifactNames = manifest.artifacts.map(({ path }) => path).sort();
  if (JSON.stringify(expectedArtifactNames) !== JSON.stringify(manifestArtifactNames)) {
    throw new Error("Music alternatives manifest artifact list is incomplete or duplicated.");
  }
  const expectedArtifactContracts = new Map<string, { role: ArtifactRole; candidateId: string }>();
  for (const candidate of candidates) {
    const names = candidateArtifactNames(candidate);
    expectedArtifactContracts.set(names.audio, { role: "audio", candidateId: candidate.id });
    expectedArtifactContracts.set(names.provenance, {
      role: "provenance",
      candidateId: candidate.id,
    });
    expectedArtifactContracts.set(names.portraitVideo, {
      role: "portrait-video",
      candidateId: candidate.id,
    });
    expectedArtifactContracts.set(names.squareVideo, {
      role: "square-video",
      candidateId: candidate.id,
    });
  }
  for (const artifact of manifest.artifacts) {
    const contract = expectedArtifactContracts.get(artifact.path);
    if (
      !contract ||
      artifact.role !== contract.role ||
      artifact.candidateId !== contract.candidateId
    ) {
      throw new Error(`Manifest role or candidate identity changed for ${artifact.path}.`);
    }
    const fileMetadata = await stat(join(directory, artifact.path));
    const actualHash = await sha256File(join(directory, artifact.path));
    if (fileMetadata.size !== artifact.bytes || actualHash !== artifact.sha256) {
      throw new Error(`Whole-file hash validation failed for ${artifact.path}.`);
    }
  }

  for (const candidate of candidates) {
    const prompt = prompts.get(candidate.id);
    const entry = manifest.candidates.find(({ id }) => id === candidate.id);
    if (
      !prompt ||
      !entry ||
      entry.title !== candidate.title ||
      entry.promptSha256 !== prompt.sha256 ||
      entry.promptPath !== `music/alternatives/${basename(candidate.promptPath)}`
    ) {
      throw new Error(`${candidate.title} manifest identity or prompt hash changed.`);
    }
    const names = candidateArtifactNames(candidate);
    if (
      entry.audioPath !== names.audio ||
      entry.provenancePath !== names.provenance ||
      entry.portraitVideoPath !== names.portraitVideo ||
      entry.squareVideoPath !== names.squareVideo
    ) {
      throw new Error(`${candidate.title} manifest artifact paths changed.`);
    }
    const current = await validateCandidateMedia(
      directory,
      candidate,
      prompt,
      expectedMasters,
      media,
      signal,
    );
    assertSamePacketFingerprint(
      current.portraitVideoPackets,
      entry.portraitVideoPackets,
      `${candidate.title} portrait video`,
    );
    assertSamePacketFingerprint(
      current.squareVideoPackets,
      entry.squareVideoPackets,
      `${candidate.title} square video`,
    );
    assertSamePacketFingerprint(
      current.audioPackets,
      entry.audioPackets,
      `${candidate.title} audio`,
    );
  }
};

export const generateMusicAlternatives = async (
  options: GenerateMusicAlternativesOptions,
  dependencies: MusicAlternativesDependencies = defaultDependencies,
): Promise<DryRunResult | GeneratedResult> => {
  const requestedCandidates = options.candidates ?? MUSIC_ALTERNATIVES;
  assertAbsolutePath(options.outputDirectory, "Output directory");
  assertAbsolutePath(options.portraitMaster, "Portrait master");
  assertAbsolutePath(options.squareMaster, "Square master");
  assertCandidateDefinitions(requestedCandidates);

  const safeInputs = await canonicalizeInputs(
    options,
    requestedCandidates,
    dependencies,
    "generate",
  );
  const { outputDirectory, portraitMaster, squareMaster, candidates } = safeInputs;
  await assertDestinationAvailable(outputDirectory);
  const prompts = await readPrompts(candidates);

  if (options.dryRun) {
    const masters = await inspectMasters({ portraitMaster, squareMaster }, dependencies.media);
    return {
      mode: "dry-run",
      outputDirectory,
      estimatedGenerationCostUsd: ESTIMATED_ALTERNATIVES_COST_USD,
      targetDurationSeconds: TARGET_DURATION_SECONDS,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        promptPath: candidate.promptPath,
        artifacts: Object.values(candidateArtifactNames(candidate)),
      })),
      masters,
    };
  }
  if (!options.apiKey) {
    throw new Error(
      "GEMINI_API_KEY is missing. Run through Doppler project shared, config dev_personal.",
    );
  }

  const parentDirectory = dirname(outputDirectory);
  const outputName = basename(outputDirectory);
  if (!outputName || outputName === "." || outputName === "..") {
    throw new Error("Output directory must name one new immutable audition set.");
  }
  await access(parentDirectory, constants.W_OK);

  const controller = new AbortController();
  let destinationLock: DestinationLock | undefined;
  let stagingDirectory: string | undefined;
  let failedRunDirectory: string | undefined;
  let paidResponseCount = 0;
  let pendingSignal: "SIGINT" | "SIGTERM" | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      controller.abort();
      const cleanupErrors: unknown[] = [];
      if (stagingDirectory) {
        try {
          if (paidResponseCount > 0) {
            failedRunDirectory = await quarantineFailedRun(stagingDirectory, outputDirectory);
          } else {
            await rm(stagingDirectory, { recursive: true, force: true });
          }
          stagingDirectory = undefined;
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (destinationLock) {
        try {
          await releaseDestinationLock(destinationLock);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (cleanupErrors.length > 0) {
        const recoveryPaths = [stagingDirectory, failedRunDirectory, destinationLock?.path]
          .filter((path): path is string => Boolean(path))
          .map(inertPath)
          .join(", ");
        throw new AggregateError(
          cleanupErrors,
          `Music alternatives cleanup was incomplete. Confirm no generation process is running, then inspect and remove only these owned paths before retrying: ${recoveryPaths}`,
        );
      }
    })();
    return cleanupPromise;
  };
  const recordSignal = (signal: "SIGINT" | "SIGTERM") => {
    pendingSignal ??= signal;
    // Active media commands observe this signal, terminate their child, and
    // await the TERM-to-KILL escalation before the main operation unwinds.
    // Exiting here would cancel that escalation and could orphan FFmpeg.
    controller.abort();
  };
  const onSigint = () => recordSignal("SIGINT");
  const onSigterm = () => recordSignal("SIGTERM");
  dependencies.signals.add("SIGINT", onSigint);
  dependencies.signals.add("SIGTERM", onSigterm);

  let result: GeneratedResult | undefined;
  let primaryError: unknown;
  try {
    if (controller.signal.aborted) throw new Error("Generation was cancelled before locking.");
    await acquireDestinationLock(outputDirectory, (lock) => {
      destinationLock = lock;
    });
    if (controller.signal.aborted) throw new Error("Generation was cancelled after locking.");
    await assertDestinationAvailable(outputDirectory);
    await dependencies.publication.preflight(parentDirectory);
    assertNotCancelled(controller.signal);
    await dependencies.media.preflight({ signal: controller.signal });
    assertNotCancelled(controller.signal);
    const masters = await inspectMasters(
      { portraitMaster, squareMaster },
      dependencies.media,
      controller.signal,
    );
    assertNotCancelled(controller.signal);
    stagingDirectory = join(
      parentDirectory,
      `.${outputName}.staging-${process.pid}-${randomUUID()}`,
    );
    await mkdir(stagingDirectory, { recursive: false });

    for (const candidate of candidates) {
      const prompt = prompts.get(candidate.id);
      if (!prompt) throw new Error(`Missing prompt for ${candidate.title}.`);
      await generateCandidate(
        stagingDirectory,
        candidate,
        prompt,
        {
          apiKey: options.apiKey,
          portraitMaster,
          squareMaster,
        },
        dependencies,
        () => {
          paidResponseCount += 1;
        },
        controller.signal,
      );
    }

    const manifest = await buildManifest(
      stagingDirectory,
      candidates,
      prompts,
      masters,
      dependencies,
      controller.signal,
    );
    await writeFile(
      join(stagingDirectory, MUSIC_ALTERNATIVES_MANIFEST),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx" },
    );

    const stagedManifest = await parseManifest(stagingDirectory);
    await validateManifest(
      stagingDirectory,
      stagedManifest,
      candidates,
      prompts,
      masters,
      dependencies.media,
      controller.signal,
    );
    // The injected publication boundary uses Darwin RENAME_EXCL in production
    // and is preflighted on this exact destination filesystem before requests.
    assertNotCancelled(controller.signal);
    await dependencies.publication.publish(stagingDirectory, outputDirectory);
    stagingDirectory = undefined;
    result = {
      mode: "generated",
      outputDirectory,
      estimatedGenerationCostUsd: manifest.estimatedGenerationCostUsd,
      manifest,
    };
  } catch (error) {
    primaryError = error;
  }

  let cleanupError: unknown;
  try {
    await cleanup();
  } catch (error) {
    cleanupError = error;
  }
  dependencies.signals.remove("SIGINT", onSigint);
  dependencies.signals.remove("SIGTERM", onSigterm);
  if (pendingSignal) {
    if (result) {
      dependencies.signals.report(
        `Music alternatives were published before ${pendingSignal}: ${inertPath(outputDirectory)}`,
      );
      if (cleanupError) {
        dependencies.signals.report(
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        );
      }
      return result;
    }
    if (failedRunDirectory) {
      dependencies.signals.report(
        `Paid generation evidence was preserved at ${inertPath(failedRunDirectory)}.`,
      );
    }
    if (cleanupError) {
      dependencies.signals.report(
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      );
    }
    dependencies.signals.exit(pendingSignal === "SIGINT" ? 130 : 143);
  }
  if (primaryError && cleanupError) {
    const failedEvidenceMessage = failedRunDirectory
      ? ` Paid generation evidence was preserved at ${inertPath(failedRunDirectory)}.`
      : "";
    throw new AggregateError(
      [primaryError, cleanupError],
      `Music alternatives failed and cleanup was incomplete.${failedEvidenceMessage}`,
    );
  }
  if (primaryError) {
    if (failedRunDirectory) {
      const message = primaryError instanceof Error ? primaryError.message : String(primaryError);
      throw new Error(
        `${message} Paid generation evidence was preserved at ${inertPath(failedRunDirectory)}.`,
        { cause: primaryError },
      );
    }
    throw primaryError;
  }
  if (cleanupError) throw cleanupError;
  if (!result) throw new Error("Music alternatives generation ended without a result.");
  return result;
};

export const verifyMusicAlternatives = async (
  options: Omit<GenerateMusicAlternativesOptions, "apiKey" | "dryRun">,
  dependencies: MusicAlternativesDependencies = defaultDependencies,
) => {
  const requestedCandidates = options.candidates ?? MUSIC_ALTERNATIVES;
  assertAbsolutePath(options.outputDirectory, "Output directory");
  assertAbsolutePath(options.portraitMaster, "Portrait master");
  assertAbsolutePath(options.squareMaster, "Square master");
  assertCandidateDefinitions(requestedCandidates);
  const safeInputs = await canonicalizeInputs(options, requestedCandidates, dependencies, "verify");
  const { outputDirectory, portraitMaster, squareMaster, candidates } = safeInputs;
  const prompts = await readPrompts(candidates);
  const masters = await inspectMasters({ portraitMaster, squareMaster }, dependencies.media);
  const manifest = await parseManifest(outputDirectory);
  await validateManifest(
    outputDirectory,
    manifest,
    candidates,
    prompts,
    masters,
    dependencies.media,
  );
  return manifest;
};

const usage = `Usage:
  bun scripts/music-alternatives.ts generate --output-dir /absolute/new-directory \\
    --portrait-master /absolute/portrait-silent.mp4 --square-master /absolute/square-silent.mp4 [--dry-run]
  bun scripts/music-alternatives.ts verify --output-dir /absolute/published-directory \\
    --portrait-master /absolute/portrait-silent.mp4 --square-master /absolute/square-silent.mp4`;

const parseCli = (args: string[]) => {
  const command = args.shift();
  if (command !== "generate" && command !== "verify") throw new Error(usage);
  const values = new Map<string, string>();
  let dryRun = false;
  while (args.length > 0) {
    const flag = args.shift();
    if (flag === "--dry-run") {
      if (dryRun) throw new Error("--dry-run may only be supplied once.");
      dryRun = true;
      continue;
    }
    if (!["--output-dir", "--portrait-master", "--square-master"].includes(flag ?? "")) {
      throw new Error(`Unknown argument: ${flag ?? "<missing>"}\n${usage}`);
    }
    if (values.has(flag as string)) throw new Error(`${flag} may only be supplied once.`);
    const value = args.shift();
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    values.set(flag as string, value);
  }
  const outputDirectory = values.get("--output-dir");
  const portraitMaster = values.get("--portrait-master");
  const squareMaster = values.get("--square-master");
  if (!outputDirectory || !portraitMaster || !squareMaster) throw new Error(usage);
  if (command === "verify" && dryRun) throw new Error("--dry-run is only valid with generate.");
  return { command, outputDirectory, portraitMaster, squareMaster, dryRun };
};

if (import.meta.main) {
  try {
    const cli = parseCli(process.argv.slice(2));
    if (cli.command === "verify") {
      const manifest = await verifyMusicAlternatives(cli);
      console.log(
        JSON.stringify(
          {
            status: "verified",
            outputDirectory: cli.outputDirectory,
            candidates: manifest.candidates.map(({ id, title }) => ({ id, title })),
            artifactCount: manifest.artifacts.length,
          },
          null,
          2,
        ),
      );
    } else {
      const result = await generateMusicAlternatives({
        ...cli,
        apiKey: process.env.GEMINI_API_KEY,
      });
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
