import type { ResolveComparableResponse } from "@mapvest/core";
import { apiBase, printKeyValue, printTable, readFlag, readJson } from "../util.js";

/**
 * `mapvest resolve <brand> [--sector <hint>]` — POSTs to
 * /v1/resolve-comparable with `{ brand, hintSector? }` and pretty-prints
 * the resolved brand line, comparables table, and top ETF exposures.
 *
 * `--sector` is an optional hint that helps the resolver rank comparable
 * public companies when the brand itself is private.
 */
export async function runResolve(
  args: string[],
  print: (s: string) => void = console.log,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const positional = args.filter((a) => !a.startsWith("--") && !a.includes("="));
  const brand = positional[0];
  if (!brand) {
    print("usage: mapvest resolve <brand> [--sector <hint>]");
    return 2;
  }
  const hintSector = readFlag(args, "sector");

  const url = `${apiBase(env)}/v1/resolve-comparable`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ brand, ...(hintSector ? { hintSector } : {}) }),
  });
  const body = (await readJson(res)) as Partial<ResolveComparableResponse> & { error?: string };

  if (!res.ok) {
    print(`error: ${res.status} ${body.error ?? "resolve failed"}`);
    return 1;
  }
  if (!body.brand) {
    print("no brand resolved");
    return 0;
  }

  const b = body.brand;
  printKeyValue(
    [
      ["brand", b.name],
      ["parent", b.parent],
      ["sector", b.sector],
      ["public", b.isPublic ? "yes" : "no"],
      [
        "ticker",
        b.ticker ? `${b.ticker.symbol}${b.ticker.exchange ? ` (${b.ticker.exchange})` : ""}` : "—",
      ],
    ],
    print,
  );

  const comps = body.comparables ?? [];
  if (comps.length > 0) {
    print("");
    print("comparables:");
    printTable(
      ["ticker", "name", "score", "reasoning"],
      comps.map((c) => [c.ticker, c.name, c.score.toFixed(2), c.reasoning]),
      print,
    );
  }

  const etfs = body.etfs ?? [];
  if (etfs.length > 0) {
    print("");
    print("ETFs:");
    printTable(
      ["ticker", "name", "weight"],
      etfs.map((e) => [e.ticker, e.name, `${(e.weight * 100).toFixed(2)}%`]),
      print,
    );
  }

  return 0;
}
