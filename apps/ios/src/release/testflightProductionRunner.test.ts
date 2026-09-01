import { describe, expect, test } from "bun:test";

import {
  ACTIVE_WORKFLOW_STATUSES,
  type CommandOptions,
  type CommandResult,
  type CommandRunner,
  PRODUCTION_WORKFLOW_FILE,
  TestFlightProductionRunner,
  parseWorkflowRuns,
} from "../../scripts/testflight-production";

const success = (stdout = ""): CommandResult => ({ exitCode: 0, stdout, stderr: "" });
const failure = (exitCode: number, stderr = "failed"): CommandResult => ({
  exitCode,
  stdout: "",
  stderr,
});

type HarnessOptions = {
  dirtyCommand?: "worktree" | "index" | "untracked";
  headSha?: string;
  activeRuns?: Partial<Record<(typeof ACTIVE_WORKFLOW_STATUSES)[number], unknown[]>>;
  workflowRunResults?: CommandResult[];
  waitResults?: CommandResult[];
  confirmationResults?: CommandResult[];
  listFailure?: boolean;
  workflowNotFound?: boolean;
  dispatch?: () => Promise<CommandResult>;
};

function createHarness(options: HarnessOptions = {}) {
  const commands: Array<{ command: string[]; options?: CommandOptions }> = [];
  const sleeps: number[] = [];
  const summaries: Array<{ id: string; url: string }> = [];
  const warnings: string[] = [];
  const persistedRunIds: string[] = [];
  const workflowRunResults = [...(options.workflowRunResults ?? [])];
  const waitResults = [...(options.waitResults ?? [success()])];
  const confirmationResults = [...(options.confirmationResults ?? [])];

  const commandRunner: CommandRunner = async (command, commandOptions) => {
    const args = [...command];
    commands.push({ command: args, options: commandOptions });

    if (args[0] === "git") {
      if (args[1] === "rev-parse") {
        return success(`${options.headSha ?? "1234567890abcdef1234567890abcdef12345678"}\n`);
      }
      const statusCommand = args[1] === "status";
      if (options.dirtyCommand && statusCommand) {
        const marker =
          options.dirtyCommand === "worktree"
            ? " M tracked.ts"
            : options.dirtyCommand === "index"
              ? "M  staged.ts"
              : "?? untracked-release-source.ts";
        return success(`${marker}\n`);
      }
      return success();
    }

    if (args[1] === "workflow:runs") {
      const queuedResult = workflowRunResults.shift();
      if (queuedResult) {
        return queuedResult;
      }
      if (options.listFailure) {
        return failure(1, "network unavailable");
      }
      if (options.workflowNotFound && args.includes("--workflow")) {
        return failure(1, "Workflow not found");
      }
      return success(JSON.stringify(Object.values(options.activeRuns ?? {}).flat()));
    }

    if (args[1] === "workflow:run") {
      return (
        options.dispatch?.() ??
        success(JSON.stringify({ id: "release-run-id", url: "https://expo.dev/release-run" }))
      );
    }

    if (args[1] === "workflow:cancel") {
      // EAS CLI logs cancellation mutation failures but still exits zero. The
      // production runner must therefore prove the terminal status separately.
      return success();
    }

    if (args[1] === "workflow:status" && args.includes("--wait")) {
      const result = waitResults.shift();
      if (!result) {
        throw new Error("test harness ran out of wait results");
      }
      return result;
    }

    if (args[1] === "workflow:status") {
      const result = confirmationResults.shift();
      if (!result) {
        throw new Error("test harness ran out of confirmation results");
      }
      return result;
    }

    throw new Error(`unexpected command: ${args.join(" ")}`);
  };

  const runner = new TestFlightProductionRunner({
    commandRunner,
    easCommand: ["eas"],
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    appendSummary: async (run) => {
      summaries.push(run);
    },
    persistRunId: async (runId) => {
      persistedRunIds.push(runId);
    },
    log: () => {},
    warn: (message) => warnings.push(message),
    releaseContext: async () => ({
      manifestHash: `sha256:${"a".repeat(64)}`,
      sourceCommitSha: "1234567890abcdef1234567890abcdef12345678",
    }),
  });

  return { runner, commands, sleeps, summaries, persistedRunIds, warnings };
}

describe("TestFlight production runner", () => {
  test("dispatches from a clean checkout and waits on the exact run ID", async () => {
    const harness = createHarness();

    expect(await harness.runner.run()).toBe(0);
    expect(harness.summaries).toEqual([
      { id: "release-run-id", url: "https://expo.dev/release-run" },
    ]);
    expect(harness.persistedRunIds).toEqual(["release-run-id"]);
    expect(harness.commands.map(({ command }) => command)).toEqual([
      ["git", "status", "--porcelain", "--untracked-files=normal"],
      ["git", "rev-parse", "HEAD"],
      ["eas", "workflow:runs", "--workflow", PRODUCTION_WORKFLOW_FILE, "--json", "--limit", "100"],
      [
        "eas",
        "workflow:run",
        `.eas/workflows/${PRODUCTION_WORKFLOW_FILE}`,
        "--input",
        `manifest_hash=sha256:${"a".repeat(64)}`,
        "--input",
        "source_commit_sha=1234567890abcdef1234567890abcdef12345678",
        "--json",
        "--no-wait",
        "--non-interactive",
      ],
      ["eas", "workflow:status", "release-run-id", "--wait", "--json", "--non-interactive"],
    ]);
    expect(harness.commands.every(({ options }) => (options?.timeoutMs ?? 0) > 0)).toBe(true);
    expect(harness.commands.at(-1)?.options?.output).toBe("inherit");
  });

  test.each(ACTIVE_WORKFLOW_STATUSES.map((status) => [status] as const))(
    "fails closed when a prior production run is %s",
    async (status) => {
      const harness = createHarness({
        activeRuns: {
          [status]: [
            { id: "orphan-run", status, workflowFileName: PRODUCTION_WORKFLOW_FILE },
            { id: "other-run", status, workflowFileName: "unrelated.yml" },
          ],
        },
      });

      await expect(harness.runner.run()).rejects.toThrow(
        `Refusing to overlap active ${PRODUCTION_WORKFLOW_FILE} runs: orphan-run (${status})`,
      );
      expect(harness.commands.some(({ command }) => command[1] === "workflow:run")).toBe(false);
    },
  );

  test("fails closed when the active-run query is unavailable", async () => {
    const harness = createHarness({ listFailure: true });

    await expect(harness.runner.run()).rejects.toThrow("network unavailable");
    expect(harness.commands.some(({ command }) => command[1] === "workflow:run")).toBe(false);
  });

  test("fails closed on a future or unknown nonterminal EAS status", async () => {
    const harness = createHarness({
      workflowRunResults: [
        success(
          JSON.stringify([
            {
              id: "waiting-run",
              status: "WAITING",
              workflowFileName: PRODUCTION_WORKFLOW_FILE,
            },
          ]),
        ),
      ],
    });

    await expect(harness.runner.run()).rejects.toThrow("unexpected shape");
    expect(harness.commands.some(({ command }) => command[1] === "workflow:run")).toBe(false);
  });

  test("falls back to one unfiltered snapshot before the workflow is registered", async () => {
    const harness = createHarness({ workflowNotFound: true });

    expect(await harness.runner.run()).toBe(0);
    expect(
      harness.commands
        .filter(({ command }) => command[1] === "workflow:runs")
        .map(({ command }) => command),
    ).toEqual([
      ["eas", "workflow:runs", "--workflow", PRODUCTION_WORKFLOW_FILE, "--json", "--limit", "100"],
      ["eas", "workflow:runs", "--json", "--limit", "100"],
    ]);
  });

  test.each(["worktree", "index", "untracked"] as const)(
    "refuses checkout drift in %s before contacting EAS",
    async (dirtyCommand) => {
      const harness = createHarness({ dirtyCommand });

      await expect(harness.runner.run()).rejects.toThrow("uncommitted changes");
      expect(harness.commands.some(({ command }) => command[0] === "eas")).toBe(false);
    },
  );

  test("refuses a clean checkout at a different commit before contacting EAS", async () => {
    const harness = createHarness({
      headSha: "abcdef1234567890abcdef1234567890abcdef12",
    });

    await expect(harness.runner.run()).rejects.toThrow("different source commit");
    expect(harness.commands.some(({ command }) => command[0] === "eas")).toBe(false);
  });

  test("retries an ambiguous waiter, cancels the exact run, and proves terminal state", async () => {
    const harness = createHarness({
      waitResults: [failure(13), failure(77), failure(13)],
      confirmationResults: [
        success(JSON.stringify({ status: "IN_PROGRESS" })),
        {
          exitCode: 12,
          stdout: JSON.stringify({ status: "CANCELED" }),
          stderr: "",
        },
      ],
    });

    expect(await harness.runner.run()).toBe(12);
    expect(harness.commands.filter(({ command }) => command[1] === "workflow:cancel").length).toBe(
      1,
    );
    expect(harness.sleeps).toEqual([15_000, 15_000, 1_000]);
    expect(harness.warnings.join("\n")).toContain("reconciling the same run");
  });

  test("reports success when reconciliation finds the remote release already succeeded", async () => {
    const harness = createHarness({
      waitResults: [failure(13), failure(13), failure(13)],
      confirmationResults: [success(JSON.stringify({ status: "SUCCESS" }))],
    });

    expect(await harness.runner.run()).toBe(0);
    expect(harness.commands.filter(({ command }) => command[1] === "workflow:cancel")).toHaveLength(
      1,
    );
  });

  test("adopts the single active run after a lost dispatch response", async () => {
    const activeRun = {
      id: "adopted-run-id",
      status: "IN_PROGRESS",
      workflowFileName: PRODUCTION_WORKFLOW_FILE,
    };
    const harness = createHarness({
      workflowRunResults: [success("[]"), success(JSON.stringify([activeRun]))],
      dispatch: async () => failure(1, "response lost"),
      confirmationResults: [
        success(
          JSON.stringify({
            status: "IN_PROGRESS",
            url: "https://expo.dev/adopted-run",
          }),
        ),
      ],
    });

    expect(await harness.runner.run()).toBe(0);
    expect(harness.persistedRunIds).toEqual(["adopted-run-id"]);
    expect(harness.summaries).toEqual([
      { id: "adopted-run-id", url: "https://expo.dev/adopted-run" },
    ]);
  });

  test("waits for a newly created run to become visible after a lost dispatch response", async () => {
    const activeRun = {
      id: "eventually-visible-run",
      status: "IN_PROGRESS",
      workflowFileName: PRODUCTION_WORKFLOW_FILE,
    };
    const harness = createHarness({
      workflowRunResults: [success("[]"), success("[]"), success(JSON.stringify([activeRun]))],
      dispatch: async () => failure(1, "response lost"),
      confirmationResults: [
        success(
          JSON.stringify({
            status: "IN_PROGRESS",
            url: "https://expo.dev/eventually-visible-run",
          }),
        ),
      ],
    });

    expect(await harness.runner.run()).toBe(0);
    expect(harness.persistedRunIds).toEqual(["eventually-visible-run"]);
    expect(harness.sleeps).toEqual([2_000]);
  });

  test("persists an adopted run before its status enrichment can fail", async () => {
    const activeRun = {
      id: "durable-adopted-run",
      status: "IN_PROGRESS",
      workflowFileName: PRODUCTION_WORKFLOW_FILE,
    };
    const harness = createHarness({
      workflowRunResults: [success("[]"), success(JSON.stringify([activeRun]))],
      dispatch: async () => failure(1, "response lost"),
      confirmationResults: [
        failure(1, "status response lost"),
        { exitCode: 12, stdout: JSON.stringify({ status: "CANCELED" }), stderr: "" },
      ],
    });

    await expect(harness.runner.run()).rejects.toThrow("invalid workflow-status JSON");
    expect(harness.persistedRunIds).toEqual(["durable-adopted-run"]);
    await expect(harness.runner.cancelAndConfirmIfStarted()).resolves.toBeUndefined();
    expect(harness.commands.some(({ command }) => command[1] === "workflow:cancel")).toBe(true);
  });

  test("does not adopt a production run that existed before an ambiguous dispatch", async () => {
    const priorRun = {
      id: "prior-success",
      status: "SUCCESS",
      workflowFileName: PRODUCTION_WORKFLOW_FILE,
    };
    const repeatedSnapshot = success(JSON.stringify([priorRun]));
    const harness = createHarness({
      workflowRunResults: [
        repeatedSnapshot,
        repeatedSnapshot,
        repeatedSnapshot,
        repeatedSnapshot,
        repeatedSnapshot,
        repeatedSnapshot,
      ],
      dispatch: async () => failure(1, "response lost"),
    });

    await expect(harness.runner.run()).rejects.toThrow(
      "no newly created production run became visible",
    );
    expect(harness.persistedRunIds).toEqual([]);
    expect(harness.sleeps).toEqual([2_000, 2_000, 2_000, 2_000]);
  });

  test("propagates a terminal remote failure without issuing cancellation", async () => {
    const harness = createHarness({ waitResults: [failure(11)] });

    expect(await harness.runner.run()).toBe(11);
    expect(harness.commands.some(({ command }) => command[1] === "workflow:cancel")).toBe(false);
  });

  test("cancels a run dispatched while shutdown was requested", async () => {
    let releaseDispatch: ((result: CommandResult) => void) | undefined;
    const dispatch = new Promise<CommandResult>((resolve) => {
      releaseDispatch = resolve;
    });
    const harness = createHarness({
      dispatch: () => dispatch,
      confirmationResults: [
        { exitCode: 12, stdout: JSON.stringify({ status: "CANCELED" }), stderr: "" },
      ],
    });

    const runPromise = harness.runner.run();
    while (!harness.commands.some(({ command }) => command[1] === "workflow:run")) {
      await Promise.resolve();
    }
    await harness.runner.requestStop(143);
    releaseDispatch?.(
      success(JSON.stringify({ id: "release-run-id", url: "https://expo.dev/release-run" })),
    );

    expect(await runPromise).toBe(143);
    expect(harness.commands.filter(({ command }) => command[1] === "workflow:cancel").length).toBe(
      1,
    );
  });

  test("reconciles a persisted run ID without dispatching another release", async () => {
    const harness = createHarness({
      confirmationResults: [
        { exitCode: 12, stdout: JSON.stringify({ status: "CANCELED" }), stderr: "" },
      ],
    });

    expect(await harness.runner.reconcileRun("persisted-run-id")).toBe("CANCELED");
    expect(harness.commands.some(({ command }) => command[1] === "workflow:run")).toBe(false);
    expect(harness.commands.some(({ command }) => command[1] === "workflow:cancel")).toBe(true);
  });

  test("bounds exact-run cancellation within the cleanup command budget", async () => {
    const harness = createHarness({
      confirmationResults: Array.from({ length: 15 }, () =>
        success(JSON.stringify({ status: "IN_PROGRESS" })),
      ),
    });

    await expect(harness.runner.reconcileRun("stuck-run-id")).rejects.toThrow(
      "did not reach a confirmed terminal status",
    );
    const cancelCommand = harness.commands.find(({ command }) => command[1] === "workflow:cancel");
    const statusCommands = harness.commands.filter(
      ({ command }) => command[1] === "workflow:status",
    );
    expect(cancelCommand?.options?.timeoutMs).toBe(15_000);
    expect(statusCommands).toHaveLength(15);
    expect(statusCommands.every(({ options }) => options?.timeoutMs === 5_000)).toBe(true);
    expect(harness.sleeps).toHaveLength(14);
  });
});

describe("workflow run JSON validation", () => {
  test("accepts the EAS workflow-runs shape and rejects unknown statuses", () => {
    expect(
      parseWorkflowRuns(
        JSON.stringify([
          {
            id: "run-id",
            status: "ACTION_REQUIRED",
            workflowFileName: PRODUCTION_WORKFLOW_FILE,
          },
        ]),
      ),
    ).toEqual([
      {
        id: "run-id",
        status: "ACTION_REQUIRED",
        workflowFileName: PRODUCTION_WORKFLOW_FILE,
      },
    ]);

    expect(() =>
      parseWorkflowRuns(
        JSON.stringify([{ id: "run-id", status: "UNKNOWN", workflowFileName: "x.yml" }]),
      ),
    ).toThrow("unexpected shape");
  });
});
