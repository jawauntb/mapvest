import { describe, expect, test } from "bun:test";
import { loadReleaseManifest } from "./releaseManifest";

const productionEasWorkflowUrl = new URL(
  "../../.eas/workflows/testflight-production.yml",
  import.meta.url,
);
const recoveryEasWorkflowUrl = new URL(
  "../../.eas/workflows/testflight-external.yml",
  import.meta.url,
);
const distributionEasWorkflowUrl = new URL(
  "../../.eas/workflows/testflight-distribute.yml",
  import.meta.url,
);
const githubProductionWorkflowUrl = new URL(
  "../../../../.github/workflows/ios-eas-production.yml",
  import.meta.url,
);
const appStoreWorkflowUrl = new URL(
  "../../../../.github/workflows/ios-app-store-release.yml",
  import.meta.url,
);
const recoveryGithubWorkflowUrl = new URL(
  "../../../../.github/workflows/ios-testflight-recovery.yml",
  import.meta.url,
);
const ledgerWorkflowUrl = new URL(
  "../../../../.github/workflows/ios-release-ledger.yml",
  import.meta.url,
);
const manifestUrl = new URL("../../release/v0.1.0.json", import.meta.url);
const testFlightRunbookUrl = new URL("../../DEPLOY_TESTFLIGHT.md", import.meta.url);
const deploymentDocUrl = new URL("../../../../docs/DEPLOY.md", import.meta.url);

type WorkflowInput = {
  required?: boolean;
  options?: string[];
};

type WorkflowStep = {
  id?: string;
  run?: string;
  "working-directory"?: string;
};

type WorkflowJob = {
  environment?: string;
  if?: string;
  needs?: string | string[];
  "timeout-minutes"?: number;
  params?: Record<string, unknown>;
  steps: WorkflowStep[];
};

function directEasSteps(workflow: WorkflowDocument): WorkflowStep[] {
  return Object.values(workflow.jobs)
    .flatMap((workflowJob) => workflowJob.steps)
    .filter((step) => /(^|\n)\s*eas\s/.test(step.run ?? ""));
}

type WorkflowDocument = {
  on: {
    workflow_dispatch: { inputs: Record<string, WorkflowInput> };
    workflow_run?: unknown;
    push?: unknown;
  };
  permissions?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
};

async function parseWorkflow(url: URL): Promise<WorkflowDocument> {
  return Bun.YAML.parse(await Bun.file(url).text()) as WorkflowDocument;
}

function job(workflow: WorkflowDocument, name: string): WorkflowJob {
  const candidate = workflow.jobs[name];
  if (!candidate) {
    throw new Error(`Missing workflow job ${name}`);
  }
  return candidate;
}

function input(inputs: Record<string, WorkflowInput>, name: string): WorkflowInput {
  const candidate = inputs[name];
  if (!candidate) {
    throw new Error(`Missing workflow input ${name}`);
  }
  return candidate;
}

describe("manifest-bound TestFlight distribution", () => {
  test("builds once, then sends only the separately inspected UUID to TestFlight", async () => {
    const buildWorkflow = await parseWorkflow(productionEasWorkflowUrl);
    const distributionWorkflow = await parseWorkflow(distributionEasWorkflowUrl);
    const manifest = await loadReleaseManifest(manifestUrl);
    const buildInputs = buildWorkflow.on.workflow_dispatch.inputs;
    const distributionInputs = distributionWorkflow.on.workflow_dispatch.inputs;
    const buildJob = job(buildWorkflow, "build_ios");
    const distributionJob = job(distributionWorkflow, "distribute_to_testflight");

    expect(Object.keys(buildWorkflow.on)).toEqual(["workflow_dispatch"]);
    expect(input(buildInputs, "manifest_hash").required).toBe(true);
    expect(input(buildInputs, "source_commit_sha").required).toBe(true);
    expect(buildInputs.what_to_test).toBeUndefined();
    expect(buildInputs.testflight_group).toBeUndefined();
    expect(buildJob.params).toEqual({ platform: "ios", profile: "production" });
    expect(buildWorkflow.jobs.distribute_to_testflight).toBeUndefined();
    for (const field of [
      "build_id",
      "manifest_hash",
      "source_commit_sha",
      "what_to_test",
      "testflight_group",
    ]) {
      expect(input(distributionInputs, field).required).toBe(true);
    }
    expect(distributionJob.params?.build_id).toBe("${{ inputs.build_id }}");
    expect(distributionJob.params?.external_groups).toEqual(["${{ inputs.testflight_group }}"]);
    expect(manifest.release.testFlightGroup).toBe("friend-testers");
    expect(distributionJob.params?.submit_beta_review).toBe(true);
    expect(distributionJob.params?.changelog).toBe("${{ inputs.what_to_test }}");
    expect(manifest.copy.testFlightWhatToTest).toContain("Mapvest beta");
  });

  test("recovers only one explicit ASC build under the same manifest binding", async () => {
    const workflow = await parseWorkflow(recoveryEasWorkflowUrl);
    const inputs = workflow.on.workflow_dispatch.inputs;
    const distributionJob = job(workflow, "distribute_to_testflight");

    expect(input(inputs, "asc_build_id").required).toBe(true);
    expect(input(inputs, "manifest_hash").required).toBe(true);
    expect(input(inputs, "source_commit_sha").required).toBe(true);
    expect(input(inputs, "what_to_test").required).toBe(true);
    expect(input(inputs, "testflight_group").required).toBe(true);
    expect(distributionJob.params?.asc_build_id).toBe("${{ inputs.asc_build_id }}");
    expect(distributionJob.params?.build_id).toBeUndefined();
    expect(distributionJob.params?.changelog).toBe("${{ inputs.what_to_test }}");
    expect(distributionJob.params?.external_groups).toEqual(["${{ inputs.testflight_group }}"]);
  });

  test("cuts no candidate on green main and requires an explicit exact manifest trigger", async () => {
    const workflow = await parseWorkflow(githubProductionWorkflowUrl);
    const dispatch = workflow.on.workflow_dispatch;
    const gate = job(workflow, "release_gate");
    const gateScript = gate.steps.find((step) => step.id === "release")?.run ?? "";

    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.on.workflow_run).toBeUndefined();
    expect(workflow.on.push).toBeUndefined();
    expect(input(dispatch.inputs, "manifest_path").required).toBe(true);
    expect(input(dispatch.inputs, "manifest_hash").required).toBe(true);
    expect(input(dispatch.inputs, "source_commit_sha").required).toBe(true);
    expect(workflow.permissions).toEqual({ actions: "read", contents: "read" });
    expect(gateScript).toContain("git/ref/heads/main");
    expect(gateScript).toContain("actions/workflows/ci.yml/runs");
    expect(gateScript).toContain("status=success");
    expect(gateScript).toContain("release-manifest.ts validate-request");
    expect(await Bun.file(githubProductionWorkflowUrl).text()).toContain("release-manifest.ts");
    expect(job(workflow, "signing_preflight").environment).toBe("ios-production-release");
    expect(job(workflow, "eas-ios").environment).toBe("ios-production-release");
    expect(job(workflow, "inspect_candidate").environment).toBe("ios-production-release");
    expect(job(workflow, "distribute_candidate").environment).toBe("ios-production-release");
    expect(job(workflow, "distribute_candidate").needs).toEqual([
      "release_gate",
      "eas-ios",
      "inspect_candidate",
    ]);
    const easSteps = directEasSteps(workflow);
    expect(easSteps).not.toHaveLength(0);
    for (const step of easSteps) {
      expect(step["working-directory"]).toBe("apps/ios");
    }
    const source = await Bun.file(githubProductionWorkflowUrl).text();
    expect(source).toContain("mapvest-ios-inspected-");
    expect(source).toContain(".eas/workflows/testflight-distribute.yml");
    expect(source).toContain('--input "build_id=$EAS_BUILD_ID"');
    expect(source.indexOf("  inspect_candidate:")).toBeLessThan(
      source.indexOf("  distribute_candidate:"),
    );
    expect(job(workflow, "eas-ios").steps.some((step) => step.run?.includes("--latest"))).toBe(
      false,
    );
  });

  test("protects recovery and derives all mutable copy from the checked-in manifest", async () => {
    const workflow = await parseWorkflow(recoveryGithubWorkflowUrl);
    const inputs = workflow.on.workflow_dispatch.inputs;
    const recover = job(workflow, "recover");
    const combined = await Bun.file(recoveryGithubWorkflowUrl).text();

    expect(Object.keys(inputs)).toEqual([
      "asc_build_id",
      "manifest_path",
      "manifest_hash",
      "source_commit_sha",
      "submit_beta_review",
    ]);
    expect(recover.environment).toBe("ios-production-release");
    expect(recover["timeout-minutes"]).toBe(90);
    expect(combined).toContain('release-manifest.ts render "$MANIFEST_PATH" testflight');
    expect(combined).toContain(".release.testFlightGroup");
    expect(combined).toContain("compare/main...$SOURCE_COMMIT_SHA");
    expect(combined).not.toContain("inputs.what_to_test");
    expect(combined).not.toContain("inputs.testflight_group");
  });

  test("creates ledgers only from a successful candidate run plus protected attestations", async () => {
    const workflow = await parseWorkflow(ledgerWorkflowUrl);
    const inputs = workflow.on.workflow_dispatch.inputs;
    const attest = job(workflow, "attest");
    const combined = await Bun.file(ledgerWorkflowUrl).text();

    for (const field of [
      "candidate_run_id",
      "physical_device_checklist",
      "app_store_metadata_audit",
      "app_privacy_audit",
      "reviewer_access",
      "subscription_review",
      "account_deletion_and_ai_consent",
    ]) {
      expect(input(inputs, field).required).toBe(true);
    }
    expect(attest.environment).toBe("ios-production-release");
    expect(attest["timeout-minutes"]).toBe(20);
    expect(combined).toContain(".github/workflows/ios-eas-production.yml");
    expect(combined).toContain(".github/workflows/ci.yml");
    expect(combined).toContain(".testFlightDistribution");
    expect(combined).toContain("mapvest-ios-candidate-${{ inputs.source_commit_sha }}");
    expect(combined).toContain("release-ledger.ts");
    expect(combined).toContain("APP_STORE_CONNECT_PRIVATE_KEY must be single-line base64");
    expect(combined).toContain("mapvest-release-ledger-${{ inputs.source_commit_sha }}");
  });

  test("protects exact-ID dry-run, submission, and storefront release separately", async () => {
    const workflow = await parseWorkflow(appStoreWorkflowUrl);
    const inputs = workflow.on.workflow_dispatch.inputs;
    const preflightScript = job(workflow, "preflight").steps.at(-1)?.run ?? "";
    const reviewJob = job(workflow, "review");
    const releaseJob = job(workflow, "storefront_release");
    const combined = await Bun.file(appStoreWorkflowUrl).text();

    expect(workflow.permissions).toEqual({ actions: "read", contents: "read" });
    expect(input(inputs, "mode").options).toEqual(["dry-run", "submit", "release"]);
    for (const field of ["manifest_path", "manifest_hash", "source_commit_sha"]) {
      expect(input(inputs, field).required).toBe(true);
    }
    expect(inputs.asc_build_id).toBeUndefined();
    expect(inputs.app_store_version_id).toBeUndefined();
    expect(preflightScript).not.toContain("git/ref/heads/main");
    expect(preflightScript).toContain("compare/main...$SOURCE_COMMIT_SHA");
    expect(preflightScript).toContain(".head_branch");
    expect(preflightScript).toContain("compare/$SOURCE_COMMIT_SHA...$producer_head_sha");
    expect(combined).toContain("release-ledger.json");
    expect(combined).not.toContain("inputs.ledger_path");
    expect(combined).not.toContain("inputs.ledger_artifact_name");
    expect(combined).toContain(".github/workflows/ios-release-ledger.yml");
    expect(combined).toContain(".github/workflows/ios-app-store-release.yml");
    expect(combined).toContain("mapvest-release-ledger-${{ inputs.source_commit_sha }}");
    expect(reviewJob.environment).toBe("app-store-review-submission");
    expect(releaseJob.environment).toBe("app-store-production-release");
    expect(reviewJob.needs).toBe("preflight");
    expect(releaseJob.needs).toBe("preflight");
    expect(reviewJob.if).toBe("${{ inputs.mode == 'dry-run' || inputs.mode == 'submit' }}");
    expect(releaseJob.if).toBe("${{ inputs.mode == 'release' }}");
    expect(reviewJob["timeout-minutes"]).toBe(30);
    expect(releaseJob["timeout-minutes"]).toBe(30);
    expect(combined).toContain("doppler run --project mapvest --config prd");
    expect(combined).toContain("APP_STORE_CONNECT_PRIVATE_KEY");
    expect(combined).toContain("must be single-line base64");
    expect(combined).toContain("if: ${{ always() }}");
    expect(combined).toContain("app-store-release.ts");
    expect(combined).not.toContain("appStoreVersionSubmissions");
    expect(combined).not.toContain("--latest");
  });

  test("documents explicit triggering, immutable ledgers, and distinct release states", async () => {
    const docs = `${await Bun.file(testFlightRunbookUrl).text()}\n${await Bun.file(deploymentDocUrl).text()}`;

    expect(docs).toContain("does not run after every green `main` merge");
    expect(docs).toContain("release manifest");
    expect(docs).toContain("runtime ledger");
    expect(docs).toContain("reviewSubmissions");
    expect(docs).toContain("app-store-review-submission");
    expect(docs).toContain("app-store-production-release");
    expect(docs).toContain(
      "upload, TestFlight, Beta Review, App Review, approval, release, and storefront availability",
    );
    expect(docs).toContain("never `--latest`");
  });
});
