import { describe, expect, test } from "bun:test";

type ProductionTestFlightWorkflow = {
  on: Record<string, unknown>;
  jobs: {
    build_ios: {
      type: string;
      params: {
        platform: string;
        profile: string;
      };
    };
    distribute_to_testflight: {
      type: string;
      needs: string[];
      params: {
        build_id: string;
        profile: string;
        external_groups: string[];
        changelog: string;
        submit_beta_review: boolean;
        wait_processing_timeout_seconds: number;
      };
    };
  };
};

type RecoveryTestFlightWorkflow = {
  on: {
    workflow_dispatch: {
      inputs: {
        asc_build_id: {
          type: string;
          required: boolean;
          description: string;
        };
        submit_beta_review: {
          type: string;
          default: boolean;
          description: string;
        };
      };
    };
  };
  jobs: {
    distribute_to_testflight: {
      type: string;
      params: Record<string, unknown> & {
        asc_build_id: string;
        external_groups: string[];
        changelog: string;
        submit_beta_review: string;
      };
    };
  };
};

const productionEasWorkflowUrl = new URL(
  "../../.eas/workflows/testflight-production.yml",
  import.meta.url,
);
const recoveryEasWorkflowUrl = new URL(
  "../../.eas/workflows/testflight-external.yml",
  import.meta.url,
);
const githubProductionWorkflowUrl = new URL(
  "../../../../.github/workflows/ios-eas-production.yml",
  import.meta.url,
);
const testFlightRunbookUrl = new URL("../../DEPLOY_TESTFLIGHT.md", import.meta.url);
const deploymentDocUrl = new URL("../../../../docs/DEPLOY.md", import.meta.url);

describe("external TestFlight distribution", () => {
  test("passes the exact native iOS build to the populated external group", async () => {
    const workflow = Bun.YAML.parse(
      await Bun.file(productionEasWorkflowUrl).text(),
    ) as ProductionTestFlightWorkflow;
    const buildJob = workflow.jobs.build_ios;
    const distributionJob = workflow.jobs.distribute_to_testflight;

    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch).toEqual({});
    expect(workflow.on.app_store_connect).toBeUndefined();
    expect(buildJob.type).toBe("build");
    expect(buildJob.params).toEqual({ platform: "ios", profile: "production" });
    expect(distributionJob.type).toBe("testflight");
    expect(distributionJob.needs).toEqual(["build_ios"]);
    expect(distributionJob.params.build_id).toBe("${{ needs.build_ios.outputs.build_id }}");
    expect(distributionJob.params.profile).toBe("production");
    expect(distributionJob.params.external_groups).toEqual(["friend-testers"]);
    expect(distributionJob.params.submit_beta_review).toBe(true);
    expect(distributionJob.params.changelog).toContain("Mapvest beta");
    expect(distributionJob.params.wait_processing_timeout_seconds).toBe(3600);
  });

  test("recovers one explicit processed App Store Connect build", async () => {
    const workflow = Bun.YAML.parse(
      await Bun.file(recoveryEasWorkflowUrl).text(),
    ) as RecoveryTestFlightWorkflow;
    const distributionJob = workflow.jobs.distribute_to_testflight;

    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch.inputs.asc_build_id).toEqual({
      type: "string",
      required: true,
      description: "Processed App Store Connect build ID to distribute.",
    });
    expect(workflow.on.workflow_dispatch.inputs.submit_beta_review).toEqual({
      type: "boolean",
      default: true,
      description: "Submit this build for Beta App Review.",
    });
    expect(Object.keys(workflow.jobs)).toEqual(["distribute_to_testflight"]);
    expect(distributionJob.type).toBe("testflight");
    expect(distributionJob.params.asc_build_id).toBe("${{ inputs.asc_build_id }}");
    expect(distributionJob.params.build_id).toBeUndefined();
    expect(distributionJob.params.profile).toBeUndefined();
    expect(distributionJob.params.wait_processing_timeout_seconds).toBeUndefined();
    expect(distributionJob.params.external_groups).toEqual(["friend-testers"]);
    expect(distributionJob.params.submit_beta_review).toBe("${{ inputs.submit_beta_review }}");
    expect(distributionJob.params.changelog).toContain("Mapvest beta");
  });

  test("validates both workflows before tracking the exact production run", async () => {
    const productionWorkflow = Bun.YAML.parse(
      await Bun.file(githubProductionWorkflowUrl).text(),
    ) as {
      concurrency: {
        group: string;
        queue: string;
        "cancel-in-progress"?: boolean;
      };
      jobs: {
        release_gate: {
          outputs: { should_release: string };
          steps: Array<{ id?: string; run?: string }>;
        };
        signing_preflight: {
          needs: string;
          if: string;
          steps: Array<{
            uses?: string;
            run?: string;
            "working-directory"?: string;
          }>;
        };
        "eas-ios": {
          if: string;
          "timeout-minutes": number;
          steps: Array<{
            env?: Record<string, string>;
            if?: string;
            "timeout-minutes"?: number;
            uses?: string;
            run?: string;
            "working-directory"?: string;
          }>;
        };
      };
    };
    const steps = productionWorkflow.jobs["eas-ios"].steps;
    const setupIndex = steps.findIndex((step) => step.uses === "expo/expo-github-action@v8");
    const validationIndex = steps.findIndex((step) => step.run?.includes("eas workflow:validate"));
    const runIndex = steps.findIndex((step) => step.run === "bun scripts/testflight-production.ts");
    const validationStep = steps[validationIndex];
    const runStep = steps[runIndex];
    const runScript = runStep?.run ?? "";
    const cleanupStep = steps.find((step) => step.run?.includes("--reconcile-run-id-file"));
    const dispatchFreshnessStep = steps.find((step) =>
      step.run?.includes("Final TestFlight release gate"),
    );
    const freshnessStep = productionWorkflow.jobs.release_gate.steps.find(
      (step) => step.id === "freshness",
    );

    expect(productionWorkflow.concurrency).toEqual({
      group: "ios-eas-production-store",
      "cancel-in-progress": false,
      queue: "max",
    });
    expect(productionWorkflow.jobs.release_gate.outputs.should_release).toBe(
      "${{ steps.freshness.outputs.should_release }}",
    );
    expect(freshnessStep?.run).toContain("gh api");
    expect(freshnessStep?.run).toContain('[[ "$REQUESTED_SHA" == "$main_sha" ]]');
    expect(freshnessStep?.run).toContain('echo "should_release=$should_release"');
    expect(productionWorkflow.jobs.signing_preflight.needs).toBe("release_gate");
    expect(productionWorkflow.jobs.signing_preflight.if).toBe(
      "needs.release_gate.outputs.should_release == 'true'",
    );
    expect(productionWorkflow.jobs["eas-ios"].if).toContain("always()");
    expect(productionWorkflow.jobs["eas-ios"].if).toContain(
      "needs.signing_preflight.result == 'success'",
    );
    expect(productionWorkflow.jobs["eas-ios"]["timeout-minutes"]).toBe(180);
    expect(setupIndex).toBeGreaterThanOrEqual(0);
    expect(validationIndex).toBeGreaterThan(setupIndex);
    expect(runIndex).toBeGreaterThan(validationIndex);
    expect(validationStep?.["working-directory"]).toBe("apps/ios");
    expect(validationStep?.run).toContain(".eas/workflows/testflight-production.yml");
    expect(validationStep?.run).toContain(".eas/workflows/testflight-external.yml");
    expect(validationStep?.run).toContain("--non-interactive");
    expect(dispatchFreshnessStep?.run).toContain("gh api");
    expect(dispatchFreshnessStep?.run).toContain('[[ "$REQUESTED_SHA" != "$main_sha" ]]');
    expect(runStep?.["working-directory"]).toBe("apps/ios");
    expect(runStep?.if).toBe(
      "${{ success() && !cancelled() && steps.dispatch_freshness.outputs.should_release == 'true' }}",
    );
    expect(
      steps
        .filter((step) => step !== cleanupStep)
        .every((step) => step.if?.includes("success()") && step.if.includes("!cancelled()")),
    ).toBe(true);
    expect(runScript).toBe("bun scripts/testflight-production.ts");
    expect(runStep?.env?.MAPVEST_EAS_RUN_ID_FILE).toContain("runner.temp");
    expect(cleanupStep?.if).toBe("${{ cancelled() }}");
    expect(cleanupStep?.["timeout-minutes"]).toBe(4);
    expect(cleanupStep?.env?.MAPVEST_EAS_RUN_ID_FILE).toBe(runStep?.env?.MAPVEST_EAS_RUN_ID_FILE);
    const installSteps = steps.filter((step) => step.run?.includes("npm "));
    expect(installSteps.map((step) => step.run)).toEqual(["npm ci --no-workspaces"]);
    expect(
      productionWorkflow.jobs.signing_preflight.steps
        .filter((step) => step.run?.includes("npm "))
        .map((step) => step.run),
    ).toEqual(["npm ci --no-workspaces"]);
    expect(steps.some((step) => step.run?.includes("eas build"))).toBe(false);
  });

  test("documents break-glass release, ASC recovery, and tester availability boundaries", async () => {
    const docs = `${await Bun.file(testFlightRunbookUrl).text()}\n${await Bun.file(deploymentDocUrl).text()}`;

    expect(docs).toContain("break-glass");
    expect(docs).toContain('select(.status != "completed")');
    expect(docs).toContain("set -euo pipefail");
    expect(docs).toContain("bun scripts/testflight-production.ts");
    expect(docs).toContain("as terminal EAS states");
    expect(docs).toContain("gh run watch GITHUB_RUN_ID --exit-status");
    expect(docs).toContain("only dispatches the GitHub workflow");
    expect(docs).toContain("skips stale out-of-order CI completions");
    expect(docs).toContain("--input asc_build_id=PROCESSED_ASC_BUILD_ID");
    expect(docs).toContain("--input submit_beta_review=false");
    expect(docs).toContain("does not mean Apple approved the build");
    expect(docs).toContain("Automatic Updates");
    expect(docs).toContain("one build of each marketing version");
    expect(docs).toContain("six TestFlight review submissions in 24 hours");
    expect(docs).toContain("newest processed pending build");
    expect(docs).toContain("not the visible build number or EAS build ID");
  });
});
