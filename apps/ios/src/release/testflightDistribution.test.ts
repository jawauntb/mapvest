import { describe, expect, test } from "bun:test";

type TestFlightWorkflow = {
  on: {
    app_store_connect: {
      build_upload: {
        states: string[];
      };
    };
    workflow_dispatch: {
      inputs: {
        asc_build_id: {
          type: string;
          required: boolean;
          description: string;
        };
      };
    };
  };
  jobs: {
    distribute_to_testflight: {
      type: string;
      params: {
        asc_build_id: string;
        external_groups: string[];
        changelog: string;
        submit_beta_review: boolean;
      };
    };
  };
};

const workflowUrl = new URL("../../.eas/workflows/testflight-external.yml", import.meta.url);
const productionWorkflowUrl = new URL(
  "../../../../.github/workflows/ios-eas-production.yml",
  import.meta.url,
);

describe("external TestFlight distribution", () => {
  test("routes each completed App Store upload to the populated external group", async () => {
    const workflowFile = Bun.file(workflowUrl);
    const workflow = Bun.YAML.parse(await workflowFile.text()) as TestFlightWorkflow;
    const job = workflow.jobs.distribute_to_testflight;

    expect(workflow.on.app_store_connect.build_upload.states).toEqual(["complete"]);
    expect(workflow.on.workflow_dispatch.inputs.asc_build_id).toEqual({
      type: "string",
      required: true,
      description: "App Store Connect build ID to distribute.",
    });
    expect(job.type).toBe("testflight");
    expect(job.params.asc_build_id).toBe(
      "${{ app_store_connect.build_upload.build.id || inputs.asc_build_id }}",
    );
    expect(job.params.external_groups).toEqual(["friend-testers"]);
    expect(job.params.submit_beta_review).toBe(true);
    expect(job.params.changelog).toContain("Mapvest beta");
  });

  test("validates the EAS workflow before the cloud build and upload", async () => {
    const productionWorkflow = Bun.YAML.parse(await Bun.file(productionWorkflowUrl).text()) as {
      jobs: {
        "eas-ios": {
          steps: Array<{
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
    const buildIndex = steps.findIndex((step) => step.run?.includes("eas build"));
    const validationStep = steps[validationIndex];

    expect(setupIndex).toBeGreaterThanOrEqual(0);
    expect(validationIndex).toBeGreaterThan(setupIndex);
    expect(buildIndex).toBeGreaterThan(validationIndex);
    expect(validationStep?.["working-directory"]).toBe("apps/ios");
    expect(validationStep?.run).toContain(".eas/workflows/testflight-external.yml");
    expect(validationStep?.run).toContain("--non-interactive");
  });
});
