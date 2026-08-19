import type { Quote } from "@mapvest/core";
import { apiBase, price, printKeyValue, readJson, signed } from "../util.js";

/**
 * `mapvest quote <symbol>` — GET /v1/quote?symbol=…
 *
 * The API returns `{ quote }` on success and `{ error }` on missing or
 * unresolvable symbols (502). Provider terms require the quote
 * disclaimer be surfaced verbatim, so we print `disclaimer` on its own line.
 */
export async function runQuote(
  args: string[],
  print: (s: string) => void = console.log,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const symbol = args[0];
  if (!symbol) {
    print("usage: mapvest quote <symbol>");
    return 2;
  }

  const url = `${apiBase(env)}/v1/quote?symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url);
  const body = (await readJson(res)) as { quote?: Quote; error?: string };

  if (!res.ok) {
    print(`error: ${res.status} ${body.error ?? "quote failed"}`);
    return 1;
  }
  const q = body.quote;
  if (!q) {
    print("no quote returned");
    return 1;
  }

  printKeyValue(
    [
      ["symbol", q.symbol],
      ["price", `${price(q.price)} ${q.currency}`],
      ["change", `${signed(q.change)} (${signed(q.changePct)}%)`],
      ["as of", q.ts],
    ],
    print,
  );
  print("");
  print(q.disclaimer);
  return 0;
}
