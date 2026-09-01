import { describe, expect, test } from "bun:test";
import {
  type CandidateEvidence,
  buildReleaseLedger,
  validateCandidateEvidence,
} from "../../scripts/release-ledger";

const manifestPath = new URL("../../release/v0.1.0.json", import.meta.url).pathname;
const manifestHash = "sha256:b6b8b5371d9ec0642cc90e6e6894f88d9456d77b4af0c58b318d7fee8498dc33";
const sourceCommitSha = "1234567890abcdef1234567890abcdef12345678";

function candidate(overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return {
    schemaVersion: 1,
    easWorkflowRunId: "eas-build-workflow-id",
    easBuildId: "eas-build-id",
    buildNumber: "128",
    marketingVersion: "0.1.0",
    bundleIdentifier: "com.mapvest.app",
    sourceCommitSha,
    manifestHash,
    githubCiRunId: "999",
    ipaSha256: "a".repeat(64),
    archiveInspection: "passed",
    testFlightWorkflowRunId: "eas-testflight-workflow-id",
    testFlightDistribution: "passed",
    ...overrides,
  };
}

describe("protected release ledger bootstrap", () => {
  test("resolves exact ASC IDs and creates every provenance-owned evidence reference", async () => {
    const calls: unknown[] = [];
    const ledger = await buildReleaseLedger({
      manifestPath,
      manifestHash,
      sourceCommitSha,
      candidate: candidate(),
      repository: "generalintelligencecompany/mapvest",
      candidateRunId: "1234",
      ledgerRunId: "5678",
      identityResolver: {
        resolveReleaseIdentity: async (input) => {
          calls.push(input);
          return { ascBuildId: "asc-build-id", appStoreVersionId: "app-version-id" };
        },
      },
    });

    expect(calls).toEqual([
      {
        appId: "6798832989",
        bundleIdentifier: "com.mapvest.app",
        marketingVersion: "0.1.0",
        buildNumber: "128",
      },
    ]);
    expect(ledger.identity).toMatchObject({
      easBuildId: "eas-build-id",
      ascBuildId: "asc-build-id",
      appStoreVersionId: "app-version-id",
    });
    expect(Object.keys(ledger.evidence).sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(ledger.evidence.testflight_distribution).toContain("runs/1234#distribute_candidate");
    expect(ledger.evidence.physical_device_checklist).toBe(
      "github-actions://generalintelligencecompany/mapvest/runs/5678#physical_device_checklist",
    );
  });

  test("rejects an uninspected, undistributed, or differently bound candidate", async () => {
    expect(() =>
      validateCandidateEvidence({ ...candidate(), archiveInspection: "unknown" }),
    ).toThrow("inspection has not passed");
    expect(() =>
      validateCandidateEvidence({ ...candidate(), testFlightDistribution: "unknown" }),
    ).toThrow("distribution has not passed");

    await expect(
      buildReleaseLedger({
        manifestPath,
        manifestHash,
        sourceCommitSha,
        candidate: candidate({ sourceCommitSha: "abcdef1234567890abcdef1234567890abcdef12" }),
        repository: "generalintelligencecompany/mapvest",
        candidateRunId: "1234",
        ledgerRunId: "5678",
        identityResolver: {
          resolveReleaseIdentity: async () => {
            throw new Error("must not resolve");
          },
        },
      }),
    ).rejects.toThrow("not bound");
  });
});
