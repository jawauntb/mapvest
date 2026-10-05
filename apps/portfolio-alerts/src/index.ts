import { type AlertConfig, loadConfig } from "./config.js";
import { composeFailure } from "./format.js";
import { runJob } from "./job.js";
import { consoleNotifier, liveNotifier } from "./notify.js";
import { FileStateStore } from "./state.js";

// Cron entrypoint. Exits 0 when skipped, silent, or alerted; 1 when rules could not be checked
// or no alert could be delivered, so the failure shows up in Railway / Actions.
//   --dry-run  print the alert instead of sending it
//   --force    ignore the weekday / run-hour / once-per-day guards

const args = new Set(process.argv.slice(2));
const env = process.env;
const dryRun = args.has("--dry-run");
const notifier = dryRun ? consoleNotifier() : liveNotifier(env);

// A broken rules edit in Doppler must page, not just turn the Railway run red.
let config: AlertConfig;
try {
  config = loadConfig(env);
} catch (err) {
  const detail = `Rules config could not be loaded: ${err instanceof Error ? err.message : err}`;
  console.error(detail);
  await notifier.send(composeFailure(detail, new Date().toISOString().slice(0, 10)));
  process.exit(1);
}

const result = await runJob({
  env,
  config,
  now: new Date(),
  store: new FileStateStore(env.PORTFOLIO_ALERTS_STATE_DIR?.trim() || ".state"),
  notifier,
  force: args.has("--force"),
});

console.log(
  JSON.stringify({
    status: result.status,
    ...("reason" in result ? { reason: result.reason } : {}),
    ...("message" in result && result.message ? { subject: result.message.subject } : {}),
  }),
);
process.exit(result.status === "failed" ? 1 : 0);
