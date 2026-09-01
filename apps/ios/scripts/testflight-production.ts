import { appendFile, readFile, rename, writeFile } from "node:fs/promises";
import { loadReleaseManifest, validateReleaseRequest } from "../src/release/releaseManifest";

export const PRODUCTION_WORKFLOW_FILE = "testflight-production.yml";
export const ACTIVE_WORKFLOW_STATUSES = ["NEW", "IN_PROGRESS", "ACTION_REQUIRED"] as const;
export const TERMINAL_WORKFLOW_STATUSES = ["SUCCESS", "FAILURE", "CANCELED"] as const;

const WAIT_RETRY_ATTEMPTS = 3;
const WAIT_RETRY_DELAY_MS = 15_000;
const DISPATCH_RECONCILIATION_ATTEMPTS = 5;
const DISPATCH_RECONCILIATION_DELAY_MS = 2_000;
const CANCEL_CONFIRM_ATTEMPTS = 15;
const CANCEL_CONFIRM_DELAY_MS = 1_000;
const QUICK_COMMAND_TIMEOUT_MS = 30_000;
const CANCEL_COMMAND_TIMEOUT_MS = 15_000;
const CANCEL_STATUS_TIMEOUT_MS = 5_000;
const DISPATCH_COMMAND_TIMEOUT_MS = 15 * 60_000;
const WAIT_COMMAND_TIMEOUT_MS = 45 * 60_000;
const FORCE_KILL_DELAY_MS = 5_000;

type ActiveWorkflowStatus = (typeof ACTIVE_WORKFLOW_STATUSES)[number];
type TerminalWorkflowStatus = (typeof TERMINAL_WORKFLOW_STATUSES)[number];
type WorkflowStatus = ActiveWorkflowStatus | TerminalWorkflowStatus;

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandOptions = {
  output?: "capture" | "inherit";
  timeoutMs?: number;
};

export type CommandRunner = (
  command: readonly string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

export type WorkflowRunSummary = {
  id: string;
  status: WorkflowStatus;
  workflowFileName: string;
};

type ProductionRunnerDependencies = {
  commandRunner?: CommandRunner;
  easCommand?: readonly string[];
  sleep?: (milliseconds: number) => Promise<void>;
  appendSummary?: (run: { id: string; url: string }) => Promise<void>;
  persistRunId?: (runId: string) => Promise<void>;
  log?: (message: string) => void;
  warn?: (message: string) => void;
  releaseContext?: () => Promise<ProductionReleaseContext>;
};

export type ProductionReleaseContext = {
  manifestHash: string;
  sourceCommitSha: string;
};

async function defaultReleaseContext(): Promise<ProductionReleaseContext> {
  const manifestPath = process.env.MAPVEST_RELEASE_MANIFEST;
  const manifestHash = process.env.MAPVEST_RELEASE_MANIFEST_HASH;
  const sourceCommitSha = process.env.MAPVEST_RELEASE_SOURCE_SHA;
  const currentMainSha = process.env.MAPVEST_CURRENT_MAIN_SHA;
  if (!manifestPath || !manifestHash || !sourceCommitSha || !currentMainSha) {
    throw new Error(
      "Production TestFlight dispatch requires manifest path/hash and exact source/current-main SHAs",
    );
  }
  const manifest = await loadReleaseManifest(manifestPath);
  const request = validateReleaseRequest({
    manifest,
    manifestHash,
    sourceCommitSha,
    currentMainSha,
  });
  return {
    manifestHash: request.manifestHash,
    sourceCommitSha: request.sourceCommitSha,
  };
}

function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return (
    typeof value === "string" &&
    ([...ACTIVE_WORKFLOW_STATUSES, ...TERMINAL_WORKFLOW_STATUSES] as string[]).includes(value)
  );
}

function parseJson(value: string, description: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`EAS returned invalid ${description} JSON`, { cause: error });
  }
}

export function parseWorkflowRuns(value: string): WorkflowRunSummary[] {
  const parsed = parseJson(value, "workflow-runs");
  if (!Array.isArray(parsed)) {
    throw new Error("EAS workflow-runs JSON must be an array");
  }

  return parsed.map((candidate, index) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !("id" in candidate) ||
      typeof candidate.id !== "string" ||
      !("status" in candidate) ||
      !isWorkflowStatus(candidate.status) ||
      !("workflowFileName" in candidate) ||
      typeof candidate.workflowFileName !== "string"
    ) {
      throw new Error(`EAS workflow-runs item ${index} has an unexpected shape`);
    }

    return {
      id: candidate.id,
      status: candidate.status,
      workflowFileName: candidate.workflowFileName,
    };
  });
}

function parseDispatchedRun(value: string): { id: string; url: string } {
  const parsed = parseJson(value, "workflow-dispatch");
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("id" in parsed) ||
    typeof parsed.id !== "string" ||
    parsed.id.length === 0 ||
    !("url" in parsed) ||
    typeof parsed.url !== "string" ||
    parsed.url.length === 0
  ) {
    throw new Error("EAS workflow-dispatch JSON is missing a run ID or URL");
  }

  return { id: parsed.id, url: parsed.url };
}

function parseWorkflowStatus(value: string): WorkflowStatus {
  const parsed = parseJson(value, "workflow-status");
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("status" in parsed) ||
    !isWorkflowStatus(parsed.status)
  ) {
    throw new Error("EAS workflow-status JSON is missing a recognized status");
  }

  return parsed.status;
}

function terminalStatusForExitCode(exitCode: number): TerminalWorkflowStatus | undefined {
  if (exitCode === 0) {
    return "SUCCESS";
  }
  if (exitCode === 11) {
    return "FAILURE";
  }
  if (exitCode === 12) {
    return "CANCELED";
  }
  return undefined;
}

function exitCodeForTerminalStatus(status: TerminalWorkflowStatus): number {
  if (status === "SUCCESS") {
    return 0;
  }
  if (status === "FAILURE") {
    return 11;
  }
  return 12;
}

async function defaultCommandRunner(
  command: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const output = options.output ?? "capture";
  const child = Bun.spawn([...command], {
    stdin: "ignore",
    stdout: output === "inherit" ? "inherit" : "pipe",
    stderr: output === "inherit" ? "inherit" : "pipe",
  });

  const stdoutPromise =
    output === "capture" ? new Response(child.stdout).text() : Promise.resolve("");
  const stderrPromise =
    output === "capture" ? new Response(child.stderr).text() : Promise.resolve("");
  let timedOut = false;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const timeoutTimer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), FORCE_KILL_DELAY_MS);
      }, options.timeoutMs)
    : undefined;
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    stdoutPromise,
    stderrPromise,
  ]);
  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
  }
  if (forceKillTimer) {
    clearTimeout(forceKillTimer);
  }

  return {
    exitCode: timedOut ? 124 : exitCode,
    stdout,
    stderr: timedOut
      ? `${stderr}\nCommand exceeded its ${options.timeoutMs}ms deadline.`.trim()
      : stderr,
  };
}

async function defaultAppendSummary(run: { id: string; url: string }): Promise<void> {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  await appendFile(
    summaryPath,
    `### EAS production workflow\n\n- Run ID: \`${run.id}\`\n- [Open workflow run](${run.url})\n`,
  );
}

async function defaultPersistRunId(runId: string): Promise<void> {
  const runIdPath = process.env.MAPVEST_EAS_RUN_ID_FILE;
  if (runIdPath) {
    const temporaryPath = `${runIdPath}.tmp-${process.pid}`;
    await writeFile(temporaryPath, `${runId}\n`, "utf8");
    await rename(temporaryPath, runIdPath);
  }
}

function formatCommandFailure(command: readonly string[], result: CommandResult): string {
  const detail = result.stderr.trim() || result.stdout.trim() || "no command output";
  return `${command.join(" ")} exited ${result.exitCode}: ${detail}`;
}

export class TestFlightProductionRunner {
  private readonly commandRunner: CommandRunner;
  private readonly easCommand: readonly string[];
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly appendSummary: (run: { id: string; url: string }) => Promise<void>;
  private readonly persistRunId: (runId: string) => Promise<void>;
  private readonly log: (message: string) => void;
  private readonly warn: (message: string) => void;
  private readonly releaseContext: () => Promise<ProductionReleaseContext>;
  private runId: string | undefined;
  private terminalStatus: TerminalWorkflowStatus | undefined;
  private stopExitCode: number | undefined;
  private cancellationPromise: Promise<TerminalWorkflowStatus> | undefined;

  constructor(dependencies: ProductionRunnerDependencies = {}) {
    this.commandRunner = dependencies.commandRunner ?? defaultCommandRunner;
    this.easCommand =
      dependencies.easCommand ??
      (process.env.GITHUB_ACTIONS === "true" ? ["eas"] : ["npx", "--yes", "eas-cli@22.0.0"]);
    this.sleep = dependencies.sleep ?? ((milliseconds) => Bun.sleep(milliseconds));
    this.appendSummary = dependencies.appendSummary ?? defaultAppendSummary;
    this.persistRunId = dependencies.persistRunId ?? defaultPersistRunId;
    this.log = dependencies.log ?? console.log;
    this.warn = dependencies.warn ?? console.warn;
    this.releaseContext = dependencies.releaseContext ?? defaultReleaseContext;
  }

  async run(): Promise<number> {
    const release = await this.releaseContext();
    await this.assertCleanCheckout(release.sourceCommitSha);
    const priorRuns = await this.assertNoActiveProductionRun();

    if (this.stopExitCode !== undefined) {
      return this.stopExitCode;
    }

    const dispatchCommand = this.eas(
      "workflow:run",
      `.eas/workflows/${PRODUCTION_WORKFLOW_FILE}`,
      "--input",
      `manifest_hash=${release.manifestHash}`,
      "--input",
      `source_commit_sha=${release.sourceCommitSha}`,
      "--json",
      "--no-wait",
      "--non-interactive",
    );
    const dispatchResult = await this.commandRunner(dispatchCommand, {
      timeoutMs: DISPATCH_COMMAND_TIMEOUT_MS,
    });
    let run: { id: string; url: string } | undefined;
    try {
      run = parseDispatchedRun(dispatchResult.stdout);
    } catch (error) {
      this.warn(error instanceof Error ? error.message : String(error));
    }
    if (!run) {
      run = await this.adoptAmbiguousDispatch(dispatchCommand, dispatchResult, priorRuns);
    } else if (dispatchResult.exitCode !== 0) {
      this.warn(
        `EAS dispatch exited ${dispatchResult.exitCode} after returning run ${run.id}; tracking that exact run.`,
      );
    }

    if (this.runId !== run.id) {
      this.runId = run.id;
      await this.persistRunId(run.id);
    }
    this.log(`Started EAS production workflow ${run.id}: ${run.url}`);
    await this.appendSummary(run);

    if (this.stopExitCode !== undefined) {
      await this.cancelAndConfirm();
      return this.stopExitCode;
    }

    for (let attempt = 1; attempt <= WAIT_RETRY_ATTEMPTS; attempt += 1) {
      const statusResult = await this.commandRunner(
        this.eas("workflow:status", run.id, "--wait", "--json", "--non-interactive"),
        { output: "inherit", timeoutMs: WAIT_COMMAND_TIMEOUT_MS },
      );
      const terminalStatus = terminalStatusForExitCode(statusResult.exitCode);
      if (terminalStatus) {
        this.terminalStatus = terminalStatus;
        if (this.cancellationPromise) {
          await this.cancellationPromise;
        }
        return this.stopExitCode ?? statusResult.exitCode;
      }

      this.warn(
        `EAS status waiter exited ${statusResult.exitCode} for ${run.id} ` +
          `(attempt ${attempt}/${WAIT_RETRY_ATTEMPTS}); reconciling the same run.`,
      );
      if (attempt < WAIT_RETRY_ATTEMPTS) {
        await this.sleep(WAIT_RETRY_DELAY_MS);
      }
    }

    const reconciledStatus = await this.cancelAndConfirm();
    return this.stopExitCode ?? exitCodeForTerminalStatus(reconciledStatus);
  }

  async requestStop(exitCode: number): Promise<void> {
    this.stopExitCode ??= exitCode;
    await this.cancelAndConfirmIfStarted();
  }

  async cancelAndConfirmIfStarted(): Promise<void> {
    if (!this.runId || this.terminalStatus) {
      return;
    }
    await this.cancelAndConfirm();
  }

  async reconcileRun(runId: string): Promise<TerminalWorkflowStatus> {
    if (this.runId && this.runId !== runId) {
      throw new Error(`Refusing to replace tracked EAS run ${this.runId} with ${runId}`);
    }
    this.runId = runId;
    return this.cancelAndConfirm();
  }

  private async assertCleanCheckout(sourceCommitSha: string): Promise<void> {
    const statusCommand = ["git", "status", "--porcelain", "--untracked-files=normal"];
    const statusResult = await this.commandRunner(statusCommand, {
      timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
    });
    if (statusResult.exitCode !== 0 || statusResult.stdout.trim().length > 0) {
      throw new Error(
        "Refusing to upload an EAS source archive from a checkout with uncommitted changes",
      );
    }
    const headCommand = ["git", "rev-parse", "HEAD"];
    const headResult = await this.commandRunner(headCommand, {
      timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
    });
    if (headResult.exitCode !== 0 || headResult.stdout.trim() !== sourceCommitSha) {
      throw new Error("Refusing to upload an EAS source archive from a different source commit");
    }
  }

  private async assertNoActiveProductionRun(): Promise<WorkflowRunSummary[]> {
    const runs = await this.listProductionRuns();
    const activeRuns = runs.filter(
      (run) => !(TERMINAL_WORKFLOW_STATUSES as readonly string[]).includes(run.status),
    );

    if (activeRuns.length > 0) {
      const descriptions = activeRuns.map((run) => `${run.id} (${run.status})`).join(", ");
      throw new Error(
        `Refusing to overlap active ${PRODUCTION_WORKFLOW_FILE} runs: ${descriptions}`,
      );
    }
    return runs;
  }

  private async listProductionRuns(): Promise<WorkflowRunSummary[]> {
    let command = this.eas(
      "workflow:runs",
      "--workflow",
      PRODUCTION_WORKFLOW_FILE,
      "--json",
      "--limit",
      "100",
    );
    let result = await this.commandRunner(command, { timeoutMs: QUICK_COMMAND_TIMEOUT_MS });
    let filterLocally = false;

    if (result.exitCode !== 0) {
      const output = `${result.stderr}\n${result.stdout}`;
      if (!/workflow not found/i.test(output)) {
        throw new Error(formatCommandFailure(command, result));
      }

      // EAS rejects a server-side filename filter until that workflow has run
      // once. The first-release fallback still uses one project-wide snapshot.
      command = this.eas("workflow:runs", "--json", "--limit", "100");
      result = await this.commandRunner(command, { timeoutMs: QUICK_COMMAND_TIMEOUT_MS });
      filterLocally = true;
    }

    if (result.exitCode !== 0) {
      throw new Error(formatCommandFailure(command, result));
    }

    const runs = parseWorkflowRuns(result.stdout);
    return filterLocally
      ? runs.filter((run) => run.workflowFileName === PRODUCTION_WORKFLOW_FILE)
      : runs;
  }

  private async adoptAmbiguousDispatch(
    dispatchCommand: readonly string[],
    dispatchResult: CommandResult,
    priorRuns: readonly WorkflowRunSummary[],
  ): Promise<{ id: string; url: string }> {
    const priorRunIds = new Set(priorRuns.map((run) => run.id));
    let candidate: WorkflowRunSummary | undefined;

    for (let attempt = 1; attempt <= DISPATCH_RECONCILIATION_ATTEMPTS; attempt += 1) {
      const newRuns = (await this.listProductionRuns()).filter((run) => !priorRunIds.has(run.id));
      if (newRuns.length > 1) {
        throw new Error(
          `${formatCommandFailure(dispatchCommand, dispatchResult)}; ` +
            `found ${newRuns.length} new production runs while reconciling dispatch`,
        );
      }
      [candidate] = newRuns;
      if (candidate) {
        break;
      }
      if (attempt < DISPATCH_RECONCILIATION_ATTEMPTS) {
        await this.sleep(DISPATCH_RECONCILIATION_DELAY_MS);
      }
    }

    if (!candidate) {
      throw new Error(
        `${formatCommandFailure(dispatchCommand, dispatchResult)}; no newly created production run became visible during reconciliation`,
      );
    }
    // The ID is the recovery primitive. Make it durable before the fallible
    // status lookup used only to enrich the GitHub summary with a URL.
    this.runId = candidate.id;
    await this.persistRunId(candidate.id);
    const statusCommand = this.eas("workflow:status", candidate.id, "--json", "--non-interactive");
    const statusResult = await this.commandRunner(statusCommand, {
      timeoutMs: QUICK_COMMAND_TIMEOUT_MS,
    });
    const parsed = parseJson(statusResult.stdout, "workflow-status");
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("url" in parsed) ||
      typeof parsed.url !== "string" ||
      parsed.url.length === 0
    ) {
      throw new Error("EAS workflow-status JSON is missing the adopted run URL");
    }
    const status = parseWorkflowStatus(statusResult.stdout);
    const expectedStatus =
      statusResult.exitCode === 11
        ? "FAILURE"
        : statusResult.exitCode === 12
          ? "CANCELED"
          : undefined;
    if (
      (statusResult.exitCode !== 0 && expectedStatus === undefined) ||
      (expectedStatus && expectedStatus !== status)
    ) {
      throw new Error(formatCommandFailure(statusCommand, statusResult));
    }

    this.warn(`Adopted new EAS workflow ${candidate.id} after an ambiguous dispatch response.`);
    return { id: candidate.id, url: parsed.url };
  }

  private async cancelAndConfirm(): Promise<TerminalWorkflowStatus> {
    if (!this.runId) {
      throw new Error("Cannot cancel an EAS workflow before its run ID is known");
    }
    if (this.terminalStatus) {
      return this.terminalStatus;
    }
    if (this.cancellationPromise) {
      return this.cancellationPromise;
    }

    const runId = this.runId;
    this.cancellationPromise = (async () => {
      this.warn(`Requesting cancellation for EAS production workflow ${runId}.`);
      await this.commandRunner(this.eas("workflow:cancel", runId, "--non-interactive"), {
        output: "inherit",
        timeoutMs: CANCEL_COMMAND_TIMEOUT_MS,
      });

      for (let attempt = 1; attempt <= CANCEL_CONFIRM_ATTEMPTS; attempt += 1) {
        if (this.terminalStatus) {
          return this.terminalStatus;
        }
        const result = await this.commandRunner(
          this.eas("workflow:status", runId, "--json", "--non-interactive"),
          { timeoutMs: CANCEL_STATUS_TIMEOUT_MS },
        );

        const expectedStatus = terminalStatusForExitCode(result.exitCode);
        if (expectedStatus) {
          try {
            const status = parseWorkflowStatus(result.stdout);
            if (status === expectedStatus) {
              this.terminalStatus = expectedStatus;
              this.log(`EAS production workflow ${runId} reached terminal status ${status}.`);
              return expectedStatus;
            }
            this.warn(
              `EAS workflow ${runId} returned exit ${result.exitCode} with mismatched status ${status}.`,
            );
          } catch (error) {
            this.warn(error instanceof Error ? error.message : String(error));
          }
        } else {
          this.warn(
            `Could not confirm terminal status for ${runId} ` +
              `(exit ${result.exitCode}, attempt ${attempt}/${CANCEL_CONFIRM_ATTEMPTS}).`,
          );
        }

        if (attempt < CANCEL_CONFIRM_ATTEMPTS) {
          await this.sleep(CANCEL_CONFIRM_DELAY_MS);
        }
      }

      throw new Error(
        `EAS workflow ${runId} did not reach a confirmed terminal status after cancellation; the next production release will refuse to overlap it`,
      );
    })();

    return this.cancellationPromise;
  }

  private eas(...arguments_: string[]): string[] {
    return [...this.easCommand, ...arguments_];
  }
}

async function main(): Promise<void> {
  const runner = new TestFlightProductionRunner();
  const reconciliationFlagIndex = process.argv.indexOf("--reconcile-run-id-file");
  if (reconciliationFlagIndex >= 0) {
    const runIdPath = process.argv[reconciliationFlagIndex + 1];
    if (!runIdPath) {
      throw new Error("--reconcile-run-id-file requires a path");
    }
    let runId: string;
    try {
      runId = (await readFile(runIdPath, "utf8")).trim();
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code === "ENOENT") {
        console.log("No persisted EAS workflow run ID; no cancellation cleanup is required.");
        return;
      }
      throw error;
    }
    if (!runId) {
      console.log("The persisted EAS workflow run ID is empty; no cleanup is required.");
      return;
    }
    const status = await runner.reconcileRun(runId);
    console.log(`Cancellation cleanup confirmed ${runId} is ${status}.`);
    return;
  }

  let cleanupFailure: unknown;

  const stop = (exitCode: number): void => {
    if (process.env.GITHUB_ACTIONS === "true") {
      console.warn(
        "GitHub canceled the release waiter; preserving any returned run ID for the cancellation cleanup step.",
      );
    }
    void runner.requestStop(exitCode).catch((error) => {
      cleanupFailure = error;
      console.error(error);
    });
  };
  const handleInterrupt = (): void => stop(130);
  const handleTerminate = (): void => stop(143);
  process.once("SIGINT", handleInterrupt);
  process.once("SIGTERM", handleTerminate);

  let exitCode = 1;
  try {
    exitCode = await runner.run();
  } catch (error) {
    console.error(error);
    try {
      await runner.cancelAndConfirmIfStarted();
    } catch (cleanupError) {
      cleanupFailure = cleanupError;
      console.error(cleanupError);
    }
  } finally {
    process.off("SIGINT", handleInterrupt);
    process.off("SIGTERM", handleTerminate);
  }

  process.exitCode = cleanupFailure ? 1 : exitCode;
}

if (import.meta.main) {
  await main();
}
