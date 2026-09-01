import { createHash } from "node:crypto";

export type ReleaseCopySurface =
  | "testflight"
  | "beta-review"
  | "app-store-whats-new"
  | "app-review";

export const RELEASE_EVIDENCE_IDS = [
  "ci",
  "xcode26_archive",
  "archive_identity_and_privacy",
  "testflight_distribution",
  "physical_device_checklist",
  "app_store_metadata_audit",
  "app_privacy_audit",
  "reviewer_access",
  "subscription_review",
  "account_deletion_and_ai_consent",
] as const;

export type ReleaseEvidenceId = (typeof RELEASE_EVIDENCE_IDS)[number];

export type ReleaseManifest = {
  schemaVersion: 1;
  manifestId: string;
  contentHash: string;
  identity: {
    bundleIdentifier: string;
    appStoreConnectAppId: string;
    marketingVersion: string;
    sourceBranch: "main";
  };
  release: {
    mode: "manual_after_approval";
    testFlightGroup: string;
    supportContact: string;
  };
  copy: {
    testFlightWhatToTest: string;
    betaReviewNotes: string;
    appStoreWhatsNew: string;
    appReviewNotes: string;
    subtitle: string;
    descriptionTheme: string;
    keywords: string;
    screenshotNarrative: string[];
  };
  reviewerWalkthrough: {
    signIn: string;
    sampleMapArea: string;
    cameraSubject: string;
    notificationTrigger: string;
    deletionAccount: string;
    fallback: string;
  };
  evidence: {
    required: ReleaseEvidenceId[];
  };
};

export type ValidatedReleaseRequest = {
  manifest: ReleaseManifest;
  manifestHash: string;
  sourceCommitSha: string;
};

export type ReleaseLedger = {
  schemaVersion: 1;
  manifestHash: string;
  sourceCommitSha: string;
  identity: {
    bundleIdentifier: string;
    appStoreConnectAppId: string;
    marketingVersion: string;
    buildNumber: string;
    easBuildId: string;
    ascBuildId: string;
    appStoreVersionId: string;
  };
  evidence: Partial<Record<ReleaseEvidenceId, string>>;
  history: Array<{ at: string; state: string; detail?: string }>;
};

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string, maxLength?: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Release manifest ${field} must be a non-empty string`);
  }
  if (maxLength !== undefined && value.length > maxLength) {
    throw new Error(`Release manifest ${field} exceeds ${maxLength} characters`);
  }
  return value;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function computeReleaseManifestHash(manifest: ReleaseManifest): string {
  const { contentHash: _contentHash, ...hashable } = manifest;
  const canonical = JSON.stringify(canonicalize(hashable));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function validateReleaseManifest(candidate: unknown): ReleaseManifest {
  if (!isRecord(candidate)) {
    throw new Error("Release manifest must be a JSON object");
  }
  const manifest = candidate as ReleaseManifest;
  if (manifest.schemaVersion !== 1) {
    throw new Error("Release manifest schemaVersion must be 1");
  }
  requireString(manifest.manifestId, "manifestId", 80);
  if (!isRecord(manifest.identity)) {
    throw new Error("Release manifest identity is required");
  }
  requireString(manifest.identity.bundleIdentifier, "identity.bundleIdentifier", 255);
  requireString(manifest.identity.appStoreConnectAppId, "identity.appStoreConnectAppId", 32);
  if (
    !VERSION_PATTERN.test(
      requireString(manifest.identity.marketingVersion, "identity.marketingVersion"),
    )
  ) {
    throw new Error("Release manifest marketing version must use x.y.z");
  }
  if (manifest.identity.sourceBranch !== "main") {
    throw new Error("Release manifest source branch must be main");
  }
  if (!isRecord(manifest.release) || manifest.release.mode !== "manual_after_approval") {
    throw new Error("Release manifest mode must be manual_after_approval");
  }
  requireString(manifest.release.testFlightGroup, "release.testFlightGroup", 100);
  requireString(manifest.release.supportContact, "release.supportContact", 254);
  if (!isRecord(manifest.copy)) {
    throw new Error("Release manifest copy is required");
  }
  requireString(manifest.copy.testFlightWhatToTest, "copy.testFlightWhatToTest", 4_000);
  requireString(manifest.copy.betaReviewNotes, "copy.betaReviewNotes", 4_000);
  requireString(manifest.copy.appStoreWhatsNew, "copy.appStoreWhatsNew", 4_000);
  requireString(manifest.copy.appReviewNotes, "copy.appReviewNotes", 4_000);
  requireString(manifest.copy.subtitle, "copy.subtitle", 30);
  requireString(manifest.copy.descriptionTheme, "copy.descriptionTheme", 4_000);
  requireString(manifest.copy.keywords, "copy.keywords", 100);
  if (
    !Array.isArray(manifest.copy.screenshotNarrative) ||
    manifest.copy.screenshotNarrative.length < 3
  ) {
    throw new Error("Release manifest screenshot narrative must include at least three frames");
  }
  for (const [index, frame] of manifest.copy.screenshotNarrative.entries()) {
    requireString(frame, `copy.screenshotNarrative[${index}]`, 200);
  }
  if (!isRecord(manifest.reviewerWalkthrough)) {
    throw new Error("Release manifest reviewer walkthrough is required");
  }
  for (const [field, value] of Object.entries(manifest.reviewerWalkthrough)) {
    requireString(value, `reviewerWalkthrough.${field}`, 1_000);
  }
  if (!isRecord(manifest.evidence) || !Array.isArray(manifest.evidence.required)) {
    throw new Error("Release manifest evidence.required is required");
  }
  if (manifest.evidence.required.length !== RELEASE_EVIDENCE_IDS.length) {
    throw new Error("Release manifest evidence must name every release gate exactly once");
  }
  const requiredEvidence = new Set(manifest.evidence.required);
  if (requiredEvidence.size !== RELEASE_EVIDENCE_IDS.length) {
    throw new Error("Release manifest evidence must not contain duplicate release gates");
  }
  for (const [index, evidence] of manifest.evidence.required.entries()) {
    requireString(evidence, `evidence.required[${index}]`, 100);
    if (!(RELEASE_EVIDENCE_IDS as readonly string[]).includes(evidence)) {
      throw new Error(`Release manifest evidence.required[${index}] is unknown`);
    }
  }
  for (const evidence of RELEASE_EVIDENCE_IDS) {
    if (!requiredEvidence.has(evidence)) {
      throw new Error(`Release manifest evidence is missing ${evidence}`);
    }
  }
  if (!HASH_PATTERN.test(requireString(manifest.contentHash, "contentHash"))) {
    throw new Error("Release manifest content hash must be sha256:<hex>");
  }
  if (manifest.contentHash !== computeReleaseManifestHash(manifest)) {
    throw new Error("Release manifest content hash does not match its immutable content");
  }
  return manifest;
}

export async function loadReleaseManifest(path: string | URL): Promise<ReleaseManifest> {
  const candidate = await Bun.file(path).json();
  return validateReleaseManifest(candidate);
}

export function renderReleaseCopy(manifest: ReleaseManifest, surface: ReleaseCopySurface): string {
  if (surface === "testflight") {
    return manifest.copy.testFlightWhatToTest;
  }
  if (surface === "beta-review") {
    return manifest.copy.betaReviewNotes;
  }
  if (surface === "app-store-whats-new") {
    return manifest.copy.appStoreWhatsNew;
  }
  return manifest.copy.appReviewNotes;
}

export function validateReleaseRequest(input: {
  manifest: ReleaseManifest;
  manifestHash: string;
  sourceCommitSha: string;
  currentMainSha: string;
}): ValidatedReleaseRequest {
  const request = validateRecordedReleaseRequest(input);
  if (input.currentMainSha !== request.sourceCommitSha) {
    throw new Error("Release source commit is not the current main SHA");
  }
  return request;
}

export function validateRecordedReleaseRequest(input: {
  manifest: ReleaseManifest;
  manifestHash: string;
  sourceCommitSha: string;
}): ValidatedReleaseRequest {
  const manifest = validateReleaseManifest(input.manifest);
  if (input.manifestHash !== manifest.contentHash) {
    throw new Error("Requested manifest hash does not match the validated release manifest");
  }
  if (!SHA_PATTERN.test(input.sourceCommitSha)) {
    throw new Error("Release source commit SHA must be a full lowercase Git SHA");
  }
  return { manifest, manifestHash: manifest.contentHash, sourceCommitSha: input.sourceCommitSha };
}

export function createReleaseLedger(
  request: ValidatedReleaseRequest,
  identity: {
    buildNumber: string;
    easBuildId: string;
    ascBuildId: string;
    appStoreVersionId: string;
  },
  now = new Date(),
): ReleaseLedger {
  for (const [field, value] of Object.entries(identity)) {
    requireString(value, `ledger.identity.${field}`, 255);
  }
  return {
    schemaVersion: 1,
    manifestHash: request.manifestHash,
    sourceCommitSha: request.sourceCommitSha,
    identity: {
      bundleIdentifier: request.manifest.identity.bundleIdentifier,
      appStoreConnectAppId: request.manifest.identity.appStoreConnectAppId,
      marketingVersion: request.manifest.identity.marketingVersion,
      ...identity,
    },
    evidence: {},
    history: [{ at: now.toISOString(), state: "manifest_validated" }],
  };
}
