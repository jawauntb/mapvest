#!/usr/bin/env bun
/**
 * mapvest CLI entrypoint.
 *
 * Hand-rolled arg parsing (no commander/yargs) — the surface is tiny and
 * every dep we don't take is one less thing to audit. Subcommands live in
 * `./commands/*` and each exports an async `run…` function that accepts
 * `(args, print, env)`. Tests import those functions directly and pass a
 * captured `print` + a scoped `env` so we never depend on process globals.
 *
 * Exit codes:
 *   0 — success
 *   1 — runtime failure (network, filesystem, API error response)
 *   2 — usage error (missing/invalid args)
 */

import { runIdentify } from "./commands/identify.js";
import { runNearby } from "./commands/nearby.js";
import { runQuote } from "./commands/quote.js";
import { runResolve } from "./commands/resolve.js";
import { apiBase } from "./util.js";

const HELP = `mapvest — CLI for the Mapvest API

Usage:
  mapvest identify <image-file>
  mapvest resolve  <brand> [--sector <hint>]
  mapvest quote    <symbol>
  mapvest nearby   --lat <n> --lng <n> [--radius <m>] [--limit <n>]

Environment:
  MAPVEST_API_URL   Override the API base (default: production Railway host).
`;

export async function main(
  argv: string[] = process.argv.slice(2),
  print: (s: string) => void = console.log,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    print(HELP);
    return cmd ? 0 : 2;
  }
  if (cmd === "--version" || cmd === "-v") {
    print("mapvest 0.1.0-alpha.0");
    return 0;
  }
  if (cmd === "--api-url") {
    print(apiBase(env));
    return 0;
  }

  switch (cmd) {
    case "identify":
      return runIdentify(rest, print, env);
    case "resolve":
      return runResolve(rest, print, env);
    case "quote":
      return runQuote(rest, print, env);
    case "nearby":
      return runNearby(rest, print, env);
    default:
      print(`unknown command: ${cmd}`);
      print("");
      print(HELP);
      return 2;
  }
}

// Only auto-run when invoked as a script. Guarded so tests can import
// `main` without triggering process.exit.
const isDirectRun =
  typeof Bun !== "undefined" ? Bun.main === import.meta.path : import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  const code = await main().catch((err: unknown) => {
    console.error(`error: ${(err as Error).message ?? err}`);
    return 1;
  });
  process.exit(code);
}
