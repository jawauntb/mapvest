import { describe, expect, test } from "bun:test";
import {
  computeReleaseManifestHash,
  createReleaseLedger,
  loadReleaseManifest,
  renderReleaseCopy,
  validateReleaseManifest,
  validateReleaseRequest,
} from "./releaseManifest";

const manifestUrl = new URL("../../release/v0.1.0.json", import.meta.url);
const sourceCommitSha = "1234567890abcdef1234567890abcdef12345678";

describe("versioned release manifest", () => {
  test("validates the checked-in manifest and its immutable content hash", async () => {
    const manifest = await loadReleaseManifest(manifestUrl);

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.identity.bundleIdentifier).toBe("com.mapvest.app");
    expect(manifest.identity.appStoreConnectAppId).toBe("6798832989");
    expect(manifest.identity.marketingVersion).toBe("0.1.0");
    expect(manifest.contentHash).toBe(computeReleaseManifestHash(manifest));
    expect(validateReleaseManifest(manifest)).toBe(manifest);
  });

  test("renders every public and reviewer surface from the same manifest", async () => {
    const manifest = await loadReleaseManifest(manifestUrl);

    expect(renderReleaseCopy(manifest, "testflight")).toBe(manifest.copy.testFlightWhatToTest);
    expect(renderReleaseCopy(manifest, "beta-review")).toBe(manifest.copy.betaReviewNotes);
    expect(renderReleaseCopy(manifest, "app-store-whats-new")).toBe(manifest.copy.appStoreWhatsNew);
    expect(renderReleaseCopy(manifest, "app-review")).toBe(manifest.copy.appReviewNotes);
    expect(renderReleaseCopy(manifest, "testflight")).toContain(
      "live first run, Nearby Quest widgets, and safer alerts",
    );
    expect(renderReleaseCopy(manifest, "app-store-whats-new")).toContain(
      "Explore the companies around you",
    );
  });

  test("fails closed on identity, evidence, copy-limit, or hash drift", async () => {
    const manifest = await loadReleaseManifest(manifestUrl);
    const invalid = structuredClone(manifest);
    invalid.identity.marketingVersion = "";
    invalid.evidence.required = [];
    invalid.copy.appStoreWhatsNew = "x".repeat(4_001);

    expect(() => validateReleaseManifest(invalid)).toThrow();
    expect(() =>
      validateReleaseManifest({ ...manifest, contentHash: `sha256:${"0".repeat(64)}` }),
    ).toThrow("content hash");

    const duplicateEvidence = structuredClone(manifest);
    duplicateEvidence.evidence.required[0] = duplicateEvidence.evidence.required[1]!;
    duplicateEvidence.contentHash = computeReleaseManifestHash(duplicateEvidence);
    expect(() => validateReleaseManifest(duplicateEvidence)).toThrow("duplicate");
  });

  test("binds one merged main SHA and exact binary IDs in a separate runtime ledger", async () => {
    const manifest = await loadReleaseManifest(manifestUrl);
    const request = validateReleaseRequest({
      manifest,
      manifestHash: manifest.contentHash,
      sourceCommitSha,
      currentMainSha: sourceCommitSha,
    });
    const ledger = createReleaseLedger(request, {
      easBuildId: "eas-build-id",
      ascBuildId: "asc-build-id",
      appStoreVersionId: "app-store-version-id",
      buildNumber: "101",
    });

    expect(ledger.manifestHash).toBe(manifest.contentHash);
    expect(ledger.sourceCommitSha).toBe(sourceCommitSha);
    expect(ledger.identity).toEqual({
      bundleIdentifier: "com.mapvest.app",
      appStoreConnectAppId: "6798832989",
      marketingVersion: "0.1.0",
      buildNumber: "101",
      easBuildId: "eas-build-id",
      ascBuildId: "asc-build-id",
      appStoreVersionId: "app-store-version-id",
    });
    expect(ledger.history.at(-1)?.state).toBe("manifest_validated");
    expect(Object.keys(ledger.evidence)).toEqual([]);
  });

  test("rejects a non-main or unbound source commit before release dispatch", async () => {
    const manifest = await loadReleaseManifest(manifestUrl);

    expect(() =>
      validateReleaseRequest({
        manifest,
        manifestHash: manifest.contentHash,
        sourceCommitSha,
        currentMainSha: "abcdef1234567890abcdef1234567890abcdef12",
      }),
    ).toThrow("current main");
    expect(() =>
      validateReleaseRequest({
        manifest,
        manifestHash: `sha256:${"f".repeat(64)}`,
        sourceCommitSha,
        currentMainSha: sourceCommitSha,
      }),
    ).toThrow("manifest hash");
  });
});
