import type { ReleaseLedger } from "./releaseManifest";

export type AppStoreReleaseLedger = ReleaseLedger & {
  runtime?: {
    reviewSubmissionId?: string;
    observedState?: string;
    updatedAt?: string;
  };
};
export type AppStoreReleaseMode = "dry-run" | "submit" | "release";

export type ReviewSubmissionState =
  | "READY_FOR_REVIEW"
  | "WAITING_FOR_REVIEW"
  | "IN_REVIEW"
  | "COMPLETE"
  | "UNRESOLVED_ISSUES"
  | "CANCELING"
  | "COMPLETING";

export const REVIEW_SUBMISSION_STATES = [
  "READY_FOR_REVIEW",
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "COMPLETE",
  "UNRESOLVED_ISSUES",
  "CANCELING",
  "COMPLETING",
] as const satisfies readonly ReviewSubmissionState[];

export function parseReviewSubmissionState(value: unknown): ReviewSubmissionState {
  if (
    typeof value !== "string" ||
    !(REVIEW_SUBMISSION_STATES as readonly string[]).includes(value)
  ) {
    throw new Error(`Unknown review submission state: ${String(value)}`);
  }
  return value as ReviewSubmissionState;
}

export type AppStoreObservation = {
  appId: string;
  appStoreVersionId: string;
  marketingVersion: string;
  ascBuildId: string;
  buildNumber: string;
  buildProcessingState: string;
  buildExpired: boolean;
  attachedBuildId: string | null;
  metadataComplete: boolean;
  agreementsValid: boolean;
  testFlightEvidenceComplete: boolean;
  reviewSubmission: {
    id: string;
    state: ReviewSubmissionState;
    itemVersionId: string | null;
  } | null;
  storefrontState: string;
};

export type AppStoreReleaseAction =
  | {
      kind: "attach_build";
      appStoreVersionId: string;
      ascBuildId: string;
    }
  | {
      kind: "create_review_submission";
      appId: string;
    }
  | {
      kind: "create_review_submission_item";
      reviewSubmissionId: string | "pending-review-submission";
      appStoreVersionId: string;
    }
  | {
      kind: "submit_review";
      reviewSubmissionId: string | "pending-review-submission";
    }
  | {
      kind: "request_storefront_release";
      appStoreVersionId: string;
    };

export type AppStoreReleaseResult = {
  state:
    | "ready_to_attach"
    | "submitted"
    | "in_review"
    | "approved"
    | "rejected"
    | "release_requested"
    | "available";
  observation: AppStoreObservation;
  plannedActions: AppStoreReleaseAction[];
};

type AppStoreReleaseDependencies = {
  inspect: (ledger: AppStoreReleaseLedger) => Promise<AppStoreObservation>;
  mutate: (action: AppStoreReleaseAction) => Promise<void>;
  onTransition?: (
    state: AppStoreReleaseResult["state"],
    observation: AppStoreObservation,
  ) => Promise<void>;
};

function assertExactIdentity(
  ledger: AppStoreReleaseLedger,
  observation: AppStoreObservation,
): void {
  const expected = ledger.identity;
  if (observation.appId !== expected.appStoreConnectAppId) {
    throw new Error(
      `App Store Connect app mismatch: expected ${expected.appStoreConnectAppId}, observed ${observation.appId}`,
    );
  }
  if (observation.appStoreVersionId !== expected.appStoreVersionId) {
    throw new Error(
      `App Store version ID mismatch: expected ${expected.appStoreVersionId}, observed ${observation.appStoreVersionId}`,
    );
  }
  if (observation.marketingVersion !== expected.marketingVersion) {
    throw new Error(
      `Marketing version mismatch: expected ${expected.marketingVersion}, observed ${observation.marketingVersion}`,
    );
  }
  if (observation.ascBuildId !== expected.ascBuildId) {
    throw new Error(
      `ASC build ID mismatch: expected ${expected.ascBuildId}, observed ${observation.ascBuildId}`,
    );
  }
  if (observation.buildNumber !== expected.buildNumber) {
    throw new Error(
      `Build number mismatch: expected ${expected.buildNumber}, observed ${observation.buildNumber}`,
    );
  }
  if (observation.buildProcessingState !== "VALID") {
    throw new Error(`Exact ASC build is not valid: ${observation.buildProcessingState}`);
  }
  if (observation.buildExpired) {
    throw new Error("Exact ASC build is expired");
  }
  if (!observation.metadataComplete) {
    throw new Error(
      "App Store metadata, privacy, reviewer, screenshot, or subscription data is incomplete",
    );
  }
  if (!observation.agreementsValid) {
    throw new Error("App Store Connect agreements or credential role are incomplete");
  }
  if (!observation.testFlightEvidenceComplete) {
    throw new Error("Exact-build TestFlight and physical-device evidence is incomplete");
  }
  const attached = observation.attachedBuildId;
  if (attached !== null && attached !== expected.ascBuildId) {
    throw new Error(`App Store version is attached to conflicting build ${attached}`);
  }
  const item = observation.reviewSubmission?.itemVersionId;
  if (item !== null && item !== undefined && item !== expected.appStoreVersionId) {
    throw new Error(`Active review submission targets conflicting version ${item}`);
  }
}

function plannedSubmitActions(
  ledger: AppStoreReleaseLedger,
  observation: AppStoreObservation,
): AppStoreReleaseAction[] {
  const actions: AppStoreReleaseAction[] = [];
  if (observation.attachedBuildId === null) {
    actions.push({
      kind: "attach_build",
      appStoreVersionId: ledger.identity.appStoreVersionId,
      ascBuildId: ledger.identity.ascBuildId,
    });
  }
  const submission = observation.reviewSubmission;
  if (!submission) {
    actions.push({
      kind: "create_review_submission",
      appId: ledger.identity.appStoreConnectAppId,
    });
    actions.push({
      kind: "create_review_submission_item",
      reviewSubmissionId: "pending-review-submission",
      appStoreVersionId: ledger.identity.appStoreVersionId,
    });
    actions.push({
      kind: "submit_review",
      reviewSubmissionId: "pending-review-submission",
    });
    return actions;
  }
  if (submission.state === "UNRESOLVED_ISSUES") {
    throw new Error(
      "The exact App Store version was rejected; record an explicit replacement decision",
    );
  }
  if (submission.state === "CANCELING") {
    throw new Error(`The exact review submission is ${submission.state.toLowerCase()}`);
  }
  if (submission.itemVersionId === null) {
    actions.push({
      kind: "create_review_submission_item",
      reviewSubmissionId: submission.id,
      appStoreVersionId: ledger.identity.appStoreVersionId,
    });
  }
  if (submission.state === "READY_FOR_REVIEW") {
    actions.push({
      kind: "submit_review",
      reviewSubmissionId: submission.id,
    });
  }
  return actions;
}

function resultState(observation: AppStoreObservation): AppStoreReleaseResult["state"] {
  if (observation.storefrontState === "READY_FOR_DISTRIBUTION") {
    return "available";
  }
  if (observation.storefrontState === "PROCESSING_FOR_DISTRIBUTION") {
    return "release_requested";
  }
  if (
    ["DEVELOPER_REJECTED", "INVALID_BINARY", "METADATA_REJECTED", "REJECTED"].includes(
      observation.storefrontState,
    )
  ) {
    return "rejected";
  }
  if (observation.storefrontState === "PENDING_DEVELOPER_RELEASE") {
    return "approved";
  }
  if (observation.reviewSubmission?.state === "COMPLETE") {
    return "approved";
  }
  if (
    observation.reviewSubmission?.state === "IN_REVIEW" ||
    observation.reviewSubmission?.state === "COMPLETING"
  ) {
    return "in_review";
  }
  if (observation.reviewSubmission?.state === "WAITING_FOR_REVIEW") {
    return "submitted";
  }
  return "ready_to_attach";
}

function actionSatisfied(
  action: AppStoreReleaseAction,
  observation: AppStoreObservation,
  ledger: AppStoreReleaseLedger,
): boolean {
  if (action.kind === "attach_build") {
    return observation.attachedBuildId === ledger.identity.ascBuildId;
  }
  if (action.kind === "create_review_submission") {
    return observation.reviewSubmission !== null;
  }
  if (action.kind === "create_review_submission_item") {
    return observation.reviewSubmission?.itemVersionId === ledger.identity.appStoreVersionId;
  }
  if (action.kind === "submit_review") {
    return Boolean(
      observation.reviewSubmission &&
        observation.reviewSubmission.id === action.reviewSubmissionId &&
        observation.reviewSubmission.itemVersionId === ledger.identity.appStoreVersionId &&
        ["WAITING_FOR_REVIEW", "IN_REVIEW", "COMPLETING", "COMPLETE"].includes(
          observation.reviewSubmission.state,
        ),
    );
  }
  return (
    observation.storefrontState === "READY_FOR_DISTRIBUTION" ||
    observation.storefrontState === "PROCESSING_FOR_DISTRIBUTION"
  );
}

export class AppStoreReleaseMachine {
  private readonly inspect: AppStoreReleaseDependencies["inspect"];
  private readonly mutate: AppStoreReleaseDependencies["mutate"];
  private readonly onTransition: NonNullable<AppStoreReleaseDependencies["onTransition"]>;

  constructor(dependencies: AppStoreReleaseDependencies) {
    this.inspect = dependencies.inspect;
    this.mutate = dependencies.mutate;
    this.onTransition = dependencies.onTransition ?? (async () => {});
  }

  async run(
    mode: AppStoreReleaseMode,
    ledger: AppStoreReleaseLedger,
  ): Promise<AppStoreReleaseResult> {
    let observation = await this.inspect(ledger);
    assertExactIdentity(ledger, observation);

    if (mode === "dry-run") {
      return {
        state: resultState(observation),
        observation,
        plannedActions: plannedSubmitActions(ledger, observation),
      };
    }

    if (mode === "release") {
      if (observation.storefrontState === "READY_FOR_DISTRIBUTION") {
        return { state: "available", observation, plannedActions: [] };
      }
      if (observation.storefrontState === "PROCESSING_FOR_DISTRIBUTION") {
        return { state: "release_requested", observation, plannedActions: [] };
      }
      if (
        observation.reviewSubmission?.state !== "COMPLETE" ||
        observation.reviewSubmission.itemVersionId !== ledger.identity.appStoreVersionId
      ) {
        throw new Error("Storefront release requires the recorded exact version to be approved");
      }
      if (observation.storefrontState !== "PENDING_DEVELOPER_RELEASE") {
        throw new Error(
          `Exact version is not awaiting developer release: ${observation.storefrontState}`,
        );
      }
      const action: AppStoreReleaseAction = {
        kind: "request_storefront_release",
        appStoreVersionId: ledger.identity.appStoreVersionId,
      };
      try {
        await this.mutate(action);
      } catch (error) {
        const reconciled = await this.inspect(ledger);
        assertExactIdentity(ledger, reconciled);
        if (!actionSatisfied(action, reconciled, ledger)) {
          throw error;
        }
        observation = reconciled;
        await this.onTransition(resultState(observation), observation);
        return {
          state: resultState(observation),
          observation,
          plannedActions: [action],
        };
      }
      observation = await this.inspect(ledger);
      assertExactIdentity(ledger, observation);
      if (!actionSatisfied(action, observation, ledger)) {
        throw new Error(`App Store action ${action.kind} was not visible on read-back`);
      }
      await this.onTransition(resultState(observation), observation);
      return {
        state: resultState(observation),
        observation,
        plannedActions: [action],
      };
    }

    const executed: AppStoreReleaseAction[] = [];
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const actions = plannedSubmitActions(ledger, observation);
      const action = actions[0];
      if (!action) {
        return { state: resultState(observation), observation, plannedActions: executed };
      }
      try {
        await this.mutate(action);
      } catch (error) {
        const reconciled = await this.inspect(ledger);
        assertExactIdentity(ledger, reconciled);
        if (!actionSatisfied(action, reconciled, ledger)) {
          throw error;
        }
        observation = reconciled;
        await this.onTransition(resultState(observation), observation);
        executed.push(action);
        continue;
      }
      observation = await this.inspect(ledger);
      assertExactIdentity(ledger, observation);
      if (!actionSatisfied(action, observation, ledger)) {
        throw new Error(`App Store action ${action.kind} was not visible on read-back`);
      }
      await this.onTransition(resultState(observation), observation);
      executed.push(action);
    }
    throw new Error("App Store release state machine exceeded its bounded transition count");
  }
}
