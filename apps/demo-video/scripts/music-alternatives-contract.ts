import { z } from "zod";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const PacketFingerprintSchema = z
  .object({
    packetCount: z.number().int().positive(),
    sha256: Sha256Schema,
    startTimeSeconds: z.number().finite(),
    endTimeSeconds: z.number().finite(),
    maxUncoveredGapSeconds: z.number().finite().nonnegative().optional(),
  })
  .strict();

const VideoStreamMetadataSchema = z
  .object({
    type: z.literal("video"),
    codec: z.string(),
    width: z.number().finite(),
    height: z.number().finite(),
    frameRate: z.number().finite(),
    pixelFormat: z.string().optional(),
  })
  .strict();

const AudioStreamMetadataSchema = z
  .object({
    type: z.literal("audio"),
    codec: z.string(),
    sampleRate: z.number().finite(),
    channels: z.number().finite(),
  })
  .strict();

export const MediaMetadataSchema = z
  .object({
    durationSeconds: z.number().finite().positive(),
    streams: z.array(
      z.discriminatedUnion("type", [VideoStreamMetadataSchema, AudioStreamMetadataSchema]),
    ),
  })
  .strict();

export const MasterSnapshotSchema = z
  .object({
    path: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    sha256: Sha256Schema,
    media: MediaMetadataSchema,
    videoPackets: PacketFingerprintSchema,
  })
  .strict();

export const CandidateManifestSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    promptPath: z.string().min(1),
    promptSha256: Sha256Schema,
    audioPath: z.string().min(1),
    provenancePath: z.string().min(1),
    portraitVideoPath: z.string().min(1),
    squareVideoPath: z.string().min(1),
    portraitVideoPackets: PacketFingerprintSchema,
    squareVideoPackets: PacketFingerprintSchema,
    audioPackets: PacketFingerprintSchema,
  })
  .strict();

export const ArtifactRoleSchema = z.enum(["audio", "provenance", "portrait-video", "square-video"]);

export const ArtifactDigestSchema = z
  .object({
    path: z.string().min(1),
    role: ArtifactRoleSchema,
    candidateId: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    sha256: Sha256Schema,
  })
  .strict();

export const MusicAlternativesManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().min(1),
    model: z.string().min(1),
    targetDurationSeconds: z.number().finite().positive(),
    estimatedGenerationCostUsd: z.number().finite().nonnegative(),
    masters: z
      .object({
        portrait: MasterSnapshotSchema,
        square: MasterSnapshotSchema,
      })
      .strict(),
    candidates: z.array(CandidateManifestSchema),
    artifacts: z.array(ArtifactDigestSchema),
  })
  .strict();

export type ArtifactRole = z.infer<typeof ArtifactRoleSchema>;
export type ArtifactDigest = z.infer<typeof ArtifactDigestSchema>;
export type MasterSnapshot = z.infer<typeof MasterSnapshotSchema>;
export type CandidateManifest = z.infer<typeof CandidateManifestSchema>;
export type MusicAlternativesManifest = z.infer<typeof MusicAlternativesManifestSchema>;
