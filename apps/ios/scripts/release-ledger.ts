import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type ReleaseEvidenceId,
  type ReleaseLedger,
  createReleaseLedger,
  loadReleaseManifest,
  validateRecordedReleaseRequest,
} from "../src/release/releaseManifest";
import { AppStoreConnectClient } from "./app-store-release";

const MANUAL_EVIDENCE_IDS = [
  "physical_device_checklist",
  "app_store_metadata_audit",
  "app_privacy_audit",
  "reviewer_access",
  "subscription_review",
  "account_deletion_and_ai_consent",
] as const satisfies readonly ReleaseEvidenceId[];

export type CandidateEvidence = {
  schemaVersion: 1;
  easWorkflowRunId: string;
  easBuildId: string;
  buildNumber: string;
  marketingVersion: string;
  bundleIdentifier: string;
  sourceCommitSha: string;
  manifestHash: string;
  githubCiRunId: string;
  ipaSha256: string;
  archiveInspection: "passed";
  testFlightWorkflowRunId: string;
  testFlightDistribution: "passed";
};

type IdentityResolver = Pick<AppStoreConnectClient, "resolveReleaseIdentity">;

function requiredString(value: unknown, description: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Candidate evidence ${description} must be a non-empty string`);
  }
  return value;
}

export function validateCandidateEvidence(value: unknown): CandidateEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Candidate evidence must be a JSON object");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) {
    throw new Error("Candidate evidence schemaVersion must be 1");
  }
  if (candidate.archiveInspection !== "passed") {
    throw new Error("Candidate archive inspection has not passed");
  }
  if (candidate.testFlightDistribution !== "passed") {
    throw new Error("Candidate TestFlight distribution has not passed");
  }
  const ipaSha256 = requiredString(candidate.ipaSha256, "IPA SHA-256");
  if (!/^[0-9a-f]{64}$/.test(ipaSha256)) {
    throw new Error("Candidate IPA SHA-256 must be 64 lowercase hexadecimal characters");
  }
  const githubCiRunId = requiredString(candidate.githubCiRunId, "GitHub CI run ID");
  if (!/^\d+$/.test(githubCiRunId)) {
    throw new Error("Candidate GitHub CI run ID must be numeric");
  }
  return {
    schemaVersion: 1,
    easWorkflowRunId: requiredString(candidate.easWorkflowRunId, "EAS build workflow ID"),
    easBuildId: requiredString(candidate.easBuildId, "EAS build ID"),
    buildNumber: requiredString(candidate.buildNumber, "build number"),
    marketingVersion: requiredString(candidate.marketingVersion, "marketing version"),
    bundleIdentifier: requiredString(candidate.bundleIdentifier, "bundle identifier"),
    sourceCommitSha: requiredString(candidate.sourceCommitSha, "source commit SHA"),
    manifestHash: requiredString(candidate.manifestHash, "manifest hash"),
    githubCiRunId,
    ipaSha256,
    archiveInspection: "passed",
    testFlightWorkflowRunId: requiredString(
      candidate.testFlightWorkflowRunId,
      "TestFlight workflow ID",
    ),
    testFlightDistribution: "passed",
  };
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`Expected --name value, received ${name ?? "end of arguments"}`);
    }
    flags.set(name.slice(2), value);
  }
  return flags;
}

function requiredFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (!value) {
    throw new Error(`Missing --${name}`);
  }
  return value;
}

function numericRunId(flags: Map<string, string>, name: string): string {
  const value = requiredFlag(flags, name);
  if (!/^\d+$/.test(value)) {
    throw new Error(`--${name} must be a numeric GitHub Actions run ID`);
  }
  return value;
}

function repository(flags: Map<string, string>): string {
  const value = requiredFlag(flags, "repository");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("--repository must use owner/name syntax");
  }
  return value;
}

export async function buildReleaseLedger(input: {
  manifestPath: string;
  manifestHash: string;
  sourceCommitSha: string;
  candidate: CandidateEvidence;
  repository: string;
  candidateRunId: string;
  ledgerRunId: string;
  identityResolver: IdentityResolver;
}): Promise<ReleaseLedger> {
  const manifest = await loadReleaseManifest(input.manifestPath);
  const request = validateRecordedReleaseRequest({
    manifest,
    manifestHash: input.manifestHash,
    sourceCommitSha: input.sourceCommitSha,
  });
  const candidate = validateCandidateEvidence(input.candidate);
  if (
    candidate.manifestHash !== request.manifestHash ||
    candidate.sourceCommitSha !== request.sourceCommitSha ||
    candidate.marketingVersion !== manifest.identity.marketingVersion ||
    candidate.bundleIdentifier !== manifest.identity.bundleIdentifier
  ) {
    throw new Error(
      "Candidate evidence is not bound to the requested manifest and source identity",
    );
  }
  const asc = await input.identityResolver.resolveReleaseIdentity({
    appId: manifest.identity.appStoreConnectAppId,
    bundleIdentifier: manifest.identity.bundleIdentifier,
    marketingVersion: manifest.identity.marketingVersion,
    buildNumber: candidate.buildNumber,
  });
  const ledger = createReleaseLedger(request, {
    buildNumber: candidate.buildNumber,
    easBuildId: candidate.easBuildId,
    ascBuildId: asc.ascBuildId,
    appStoreVersionId: asc.appStoreVersionId,
  });
  const candidateRun = `github-actions://${input.repository}/runs/${input.candidateRunId}`;
  const ledgerRun = `github-actions://${input.repository}/runs/${input.ledgerRunId}`;
  ledger.evidence = {
    ci: `github-actions://${input.repository}/runs/${candidate.githubCiRunId}#ci`,
    xcode26_archive: `${candidateRun}#signing_preflight`,
    archive_identity_and_privacy: `${candidateRun}#inspect_candidate;ipa-sha256=${candidate.ipaSha256}`,
    testflight_distribution: `${candidateRun}#distribute_candidate;eas-run=${candidate.testFlightWorkflowRunId}`,
  };
  for (const evidenceId of MANUAL_EVIDENCE_IDS) {
    ledger.evidence[evidenceId] = `${ledgerRun}#${evidenceId}`;
  }
  ledger.history.push({
    at: new Date().toISOString(),
    state: "release_evidence_attested",
    detail: `candidate-run=${input.candidateRunId}`,
  });
  return ledger;
}

async function main(): Promise<void> {
  const flags = parseFlags(Bun.argv.slice(2));
  for (const evidenceId of MANUAL_EVIDENCE_IDS) {
    if (requiredFlag(flags, evidenceId.replaceAll("_", "-")) !== "true") {
      throw new Error(`Protected attestation ${evidenceId} must be explicitly true`);
    }
  }
  const candidate = validateCandidateEvidence(
    JSON.parse(await readFile(resolve(requiredFlag(flags, "candidate")), "utf8")),
  );
  const ledger = await buildReleaseLedger({
    manifestPath: requiredFlag(flags, "manifest"),
    manifestHash: requiredFlag(flags, "manifest-hash"),
    sourceCommitSha: requiredFlag(flags, "source-sha"),
    candidate,
    repository: repository(flags),
    candidateRunId: numericRunId(flags, "candidate-run-id"),
    ledgerRunId: numericRunId(flags, "ledger-run-id"),
    identityResolver: new AppStoreConnectClient(),
  });
  process.stdout.write(`${JSON.stringify(ledger, null, 2)}\n`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
