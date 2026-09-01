import { describe, expect, test } from "bun:test";
import {
  type AppStoreObservation,
  type AppStoreReleaseLedger,
  AppStoreReleaseMachine,
  parseReviewSubmissionState,
} from "./appStoreRelease";

function ledger(overrides: Partial<AppStoreReleaseLedger> = {}): AppStoreReleaseLedger {
  return {
    schemaVersion: 1,
    manifestHash: `sha256:${"a".repeat(64)}`,
    sourceCommitSha: "1234567890abcdef1234567890abcdef12345678",
    identity: {
      bundleIdentifier: "com.mapvest.app",
      appStoreConnectAppId: "6798832989",
      marketingVersion: "0.2.0",
      buildNumber: "101",
      easBuildId: "eas-build-id",
      ascBuildId: "asc-build-id",
      appStoreVersionId: "version-id",
    },
    evidence: {
      testflight_distribution: "artifact://testflight",
      physical_device_checklist: "artifact://devices",
      app_store_metadata_audit: "artifact://metadata",
    },
    history: [{ at: "2026-09-01T00:00:00.000Z", state: "manifest_validated" }],
    ...overrides,
  };
}

function observation(overrides: Partial<AppStoreObservation> = {}): AppStoreObservation {
  return {
    appId: "6798832989",
    appStoreVersionId: "version-id",
    marketingVersion: "0.2.0",
    ascBuildId: "asc-build-id",
    buildNumber: "101",
    buildProcessingState: "VALID",
    buildExpired: false,
    attachedBuildId: null,
    metadataComplete: true,
    agreementsValid: true,
    testFlightEvidenceComplete: true,
    reviewSubmission: null,
    storefrontState: "PREPARE_FOR_SUBMISSION",
    ...overrides,
  };
}

describe("exact App Store release state machine", () => {
  test("dry-run reports exact planned mutations without mutating", async () => {
    const mutations: string[] = [];
    const machine = new AppStoreReleaseMachine({
      inspect: async () => observation(),
      mutate: async (action) => {
        mutations.push(action.kind);
      },
    });

    const result = await machine.run("dry-run", ledger());

    expect(result.state).toBe("ready_to_attach");
    expect(result.plannedActions.map((action) => action.kind)).toEqual([
      "attach_build",
      "create_review_submission",
      "create_review_submission_item",
      "submit_review",
    ]);
    expect(mutations).toEqual([]);
  });

  test("uses only reviewSubmissions and reviewSubmissionItems for review", async () => {
    const actions: string[] = [];
    const transitions: string[] = [];
    let current = observation();
    const machine = new AppStoreReleaseMachine({
      inspect: async () => current,
      mutate: async (action) => {
        actions.push(action.kind);
        if (action.kind === "attach_build") {
          current = observation({ attachedBuildId: "asc-build-id" });
        } else if (action.kind === "create_review_submission") {
          current = observation({
            attachedBuildId: "asc-build-id",
            reviewSubmission: { id: "review-id", state: "READY_FOR_REVIEW", itemVersionId: null },
          });
        } else if (action.kind === "create_review_submission_item") {
          current = observation({
            attachedBuildId: "asc-build-id",
            reviewSubmission: {
              id: "review-id",
              state: "READY_FOR_REVIEW",
              itemVersionId: "version-id",
            },
          });
        } else if (action.kind === "submit_review") {
          current = observation({
            attachedBuildId: "asc-build-id",
            reviewSubmission: {
              id: "review-id",
              state: "WAITING_FOR_REVIEW",
              itemVersionId: "version-id",
            },
          });
        }
      },
      onTransition: async (state) => {
        transitions.push(state);
      },
    });

    const result = await machine.run("submit", ledger());

    expect(result.state).toBe("submitted");
    expect(actions).toEqual([
      "attach_build",
      "create_review_submission",
      "create_review_submission_item",
      "submit_review",
    ]);
    expect(transitions).toEqual([
      "ready_to_attach",
      "ready_to_attach",
      "ready_to_attach",
      "submitted",
    ]);
  });

  test.each([
    ["wrong app", observation({ appId: "other-app" })],
    ["wrong version", observation({ marketingVersion: "9.9.9" })],
    ["wrong build", observation({ ascBuildId: "other-build" })],
    ["invalid build", observation({ buildProcessingState: "FAILED" })],
    ["expired build", observation({ buildExpired: true })],
    ["missing metadata", observation({ metadataComplete: false })],
    ["agreements gate", observation({ agreementsValid: false })],
    ["missing evidence", observation({ testFlightEvidenceComplete: false })],
  ] as const)("stops on %s without mutation", async (_label, observed) => {
    const mutations: string[] = [];
    const machine = new AppStoreReleaseMachine({
      inspect: async () => observed,
      mutate: async (action) => {
        mutations.push(action.kind);
      },
    });

    await expect(machine.run("submit", ledger())).rejects.toThrow();
    expect(mutations).toEqual([]);
  });

  test("adopts the same ready review draft after an ambiguous create response", async () => {
    const actions: string[] = [];
    let current = observation({ attachedBuildId: "asc-build-id" });
    const machine = new AppStoreReleaseMachine({
      inspect: async () => current,
      mutate: async (action) => {
        actions.push(action.kind);
        if (action.kind === "create_review_submission") {
          current = observation({
            attachedBuildId: "asc-build-id",
            reviewSubmission: { id: "adopted-id", state: "READY_FOR_REVIEW", itemVersionId: null },
          });
          throw new Error("ambiguous response");
        }
        if (action.kind === "create_review_submission_item") {
          current = observation({
            attachedBuildId: "asc-build-id",
            reviewSubmission: {
              id: "adopted-id",
              state: "READY_FOR_REVIEW",
              itemVersionId: "version-id",
            },
          });
        }
        if (action.kind === "submit_review") {
          current = observation({
            attachedBuildId: "asc-build-id",
            reviewSubmission: {
              id: "adopted-id",
              state: "WAITING_FOR_REVIEW",
              itemVersionId: "version-id",
            },
          });
        }
      },
    });

    const result = await machine.run("submit", ledger());

    expect(result.state).toBe("submitted");
    expect(actions.filter((action) => action === "create_review_submission")).toHaveLength(1);
  });

  test("does not accept an ambiguous submit when no matching submission is visible", async () => {
    const current = observation({
      attachedBuildId: "asc-build-id",
      reviewSubmission: {
        id: "review-id",
        state: "READY_FOR_REVIEW",
        itemVersionId: "version-id",
      },
    });
    const machine = new AppStoreReleaseMachine({
      inspect: async () => observation({ attachedBuildId: "asc-build-id" }),
      mutate: async () => {
        throw new Error("ambiguous submit response");
      },
    });

    await expect(machine.run("submit", ledger())).rejects.toThrow("ambiguous submit response");
    expect(current.reviewSubmission?.id).toBe("review-id");
  });

  test("fails closed on unknown App Store review states", () => {
    expect(() => parseReviewSubmissionState("FUTURE_STATE")).toThrow("Unknown review submission");
  });

  test("requires approval and releases only the recorded approved version", async () => {
    const actions: string[] = [];
    let current = observation({
      attachedBuildId: "asc-build-id",
      reviewSubmission: { id: "review-id", state: "COMPLETE", itemVersionId: "version-id" },
      storefrontState: "PENDING_DEVELOPER_RELEASE",
    });
    const machine = new AppStoreReleaseMachine({
      inspect: async () => current,
      mutate: async (action) => {
        actions.push(action.kind);
        current = observation({
          attachedBuildId: "asc-build-id",
          reviewSubmission: { id: "review-id", state: "COMPLETE", itemVersionId: "version-id" },
          storefrontState: "READY_FOR_DISTRIBUTION",
        });
      },
    });

    const result = await machine.run("release", ledger());

    expect(actions).toEqual(["request_storefront_release"]);
    expect(result.state).toBe("available");
  });

  test("reconciles an accepted storefront release after an ambiguous response", async () => {
    const transitions: string[] = [];
    let current = observation({
      attachedBuildId: "asc-build-id",
      reviewSubmission: { id: "review-id", state: "COMPLETE", itemVersionId: "version-id" },
      storefrontState: "PENDING_DEVELOPER_RELEASE",
    });
    const machine = new AppStoreReleaseMachine({
      inspect: async () => current,
      mutate: async () => {
        current = observation({
          attachedBuildId: "asc-build-id",
          reviewSubmission: { id: "review-id", state: "COMPLETE", itemVersionId: "version-id" },
          storefrontState: "PROCESSING_FOR_DISTRIBUTION",
        });
        throw new Error("response lost after release request");
      },
      onTransition: async (state) => {
        transitions.push(state);
      },
    });

    const result = await machine.run("release", ledger());

    expect(result.state).toBe("release_requested");
    expect(transitions).toEqual(["release_requested"]);
  });

  test("reports current storefront rejection and distribution states truthfully", async () => {
    const rejected = new AppStoreReleaseMachine({
      inspect: async () =>
        observation({
          attachedBuildId: "asc-build-id",
          reviewSubmission: { id: "review-id", state: "COMPLETE", itemVersionId: "version-id" },
          storefrontState: "REJECTED",
        }),
      mutate: async () => {},
    });
    const processing = new AppStoreReleaseMachine({
      inspect: async () =>
        observation({
          attachedBuildId: "asc-build-id",
          reviewSubmission: { id: "review-id", state: "COMPLETE", itemVersionId: "version-id" },
          storefrontState: "PROCESSING_FOR_DISTRIBUTION",
        }),
      mutate: async () => {},
    });

    expect((await rejected.run("dry-run", ledger())).state).toBe("rejected");
    expect((await processing.run("release", ledger())).state).toBe("release_requested");
  });
});
