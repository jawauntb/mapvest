import { randomUUID } from "node:crypto";
import { rename, rm, stat } from "node:fs/promises";
import {
  LyriaInteractionRequest,
  LyriaInteractionResponse,
  type LyriaInteractionResponse as LyriaInteractionResponseType,
} from "@mapvest/core/schemas";

/**
 * Lyria can take more than a minute to synthesize a full track. Five minutes
 * leaves a generous generation window while still bounding the single paid
 * request; callers intentionally do not retry a timed-out request.
 */
export const LYRIA_REQUEST_TIMEOUT_MS = 5 * 60 * 1_000;

export type LyriaFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type RequestLyriaOptions = {
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: LyriaFetch;
};

const isRequestTimeout = (error: unknown) =>
  error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

export const requestLyria = async ({
  endpoint,
  apiKey,
  model,
  prompt,
  timeoutMs = LYRIA_REQUEST_TIMEOUT_MS,
  signal,
  fetchImpl = fetch,
}: RequestLyriaOptions): Promise<LyriaInteractionResponseType> => {
  const request = LyriaInteractionRequest.parse({ model, input: prompt, store: false });
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(request),
      signal: requestSignal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new Error("Lyria request was cancelled. No retry was attempted.", { cause: error });
    }
    if (isRequestTimeout(error)) {
      throw new Error(
        `Lyria request timed out after ${Math.ceil(timeoutMs / 1_000)} seconds. No retry was attempted.`,
        { cause: error },
      );
    }
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Lyria request failed with HTTP ${response.status}. No retry was attempted.`);
  }

  let rawPayload: unknown;
  try {
    rawPayload = await response.json();
  } catch (error) {
    if (signal?.aborted) {
      throw new Error("Lyria request was cancelled. No retry was attempted.", { cause: error });
    }
    if (timeoutSignal.aborted && isRequestTimeout(error)) {
      throw new Error(
        `Lyria request timed out after ${Math.ceil(timeoutMs / 1_000)} seconds. No retry was attempted.`,
        { cause: error },
      );
    }
    throw new Error("Lyria returned invalid JSON. No retry was attempted.", { cause: error });
  }

  const parsed = LyriaInteractionResponse.safeParse(rawPayload);
  if (!parsed.success) {
    throw new Error("Lyria returned an invalid interaction response. No retry was attempted.", {
      cause: parsed.error,
    });
  }
  return parsed.data;
};

export type MusicArtifactPaths = {
  audioPath: string;
  provenancePath: string;
};

export type MusicFileOperations = {
  exists: (path: string) => Promise<boolean>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
};

const pathExists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

const defaultFileOperations: MusicFileOperations = {
  exists: pathExists,
  rename,
  remove: (path) => rm(path, { force: true, recursive: true }),
};

export const assertMusicReplacementReady = async (
  accepted: MusicArtifactPaths,
  force: boolean,
  operations: MusicFileOperations = defaultFileOperations,
) => {
  const [audioExists, provenanceExists] = await Promise.all([
    operations.exists(accepted.audioPath),
    operations.exists(accepted.provenancePath),
  ]);

  if (audioExists !== provenanceExists) {
    throw new Error(
      "Accepted music artifacts are incomplete; restore or remove the existing MP3/provenance pair before generating.",
    );
  }
  if (!force && audioExists) {
    throw new Error(
      "Music output already exists. Pass --force to replace both accepted artifacts.",
    );
  }

  return audioExists;
};

type PromoteMusicArtifactsOptions = {
  staged: MusicArtifactPaths;
  accepted: MusicArtifactPaths;
  force: boolean;
  operations?: MusicFileOperations;
};

export const promoteMusicArtifacts = async ({
  staged,
  accepted,
  force,
  operations = defaultFileOperations,
}: PromoteMusicArtifactsOptions) => {
  const [stagedAudioExists, stagedProvenanceExists] = await Promise.all([
    operations.exists(staged.audioPath),
    operations.exists(staged.provenancePath),
  ]);
  if (!stagedAudioExists || !stagedProvenanceExists) {
    throw new Error("Both staged music artifacts must exist before publication.");
  }

  const hasAcceptedPair = await assertMusicReplacementReady(accepted, force, operations);
  const backupSuffix = `.backup-${process.pid}-${randomUUID()}`;
  const backup: MusicArtifactPaths = {
    audioPath: `${accepted.audioPath}${backupSuffix}`,
    provenancePath: `${accepted.provenancePath}${backupSuffix}`,
  };
  const backedUp: Array<[string, string]> = [];
  const promoted: string[] = [];

  try {
    if (hasAcceptedPair) {
      await operations.rename(accepted.audioPath, backup.audioPath);
      backedUp.push([backup.audioPath, accepted.audioPath]);
      await operations.rename(accepted.provenancePath, backup.provenancePath);
      backedUp.push([backup.provenancePath, accepted.provenancePath]);
    }

    await operations.rename(staged.audioPath, accepted.audioPath);
    promoted.push(accepted.audioPath);
    await operations.rename(staged.provenancePath, accepted.provenancePath);
    promoted.push(accepted.provenancePath);
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const path of promoted.reverse()) {
      try {
        await operations.remove(path);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const [backupPath, acceptedPath] of backedUp.reverse()) {
      try {
        await operations.rename(backupPath, acceptedPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `Music publication failed and rollback was incomplete; recoverable backups use suffix ${backupSuffix}.`,
      );
    }
    throw new Error(
      hasAcceptedPair
        ? "Music publication failed; the prior accepted pair was restored."
        : "Music publication failed; no accepted artifacts were changed.",
      { cause: error },
    );
  }

  await Promise.all([
    operations.remove(backup.audioPath),
    operations.remove(backup.provenancePath),
  ]);
};
