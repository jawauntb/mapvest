import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { IdentifyResponse } from "@mapvest/core";
import { apiBase, price, printKeyValue, readJson, signed } from "../util.js";

/**
 * `mapvest identify <image-file>` — uploads a local image as multipart to
 * POST /v1/identify and pretty-prints the top brand, its ticker, the top
 * three comparables, and the top ETF exposure.
 *
 * Uses a Blob wrapped around the file bytes so we don't depend on Node's
 * File constructor being available in all runtimes (Bun always is; Node
 * < 20 doesn't have it globally). Content-Type is best-effort from the
 * extension — the API sniffs it anyway.
 */
export async function runIdentify(
  args: string[],
  print: (s: string) => void = console.log,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const file = args[0];
  if (!file) {
    print("usage: mapvest identify <image-file>");
    return 2;
  }

  let bytes: Uint8Array;
  try {
    await stat(file);
    bytes = await readFile(file);
  } catch (err) {
    print(`error: cannot read ${file}: ${(err as Error).message}`);
    return 1;
  }

  const form = new FormData();
  const mime = guessMime(file);
  form.set("image", new Blob([bytes], { type: mime }), basename(file));

  const url = `${apiBase(env)}/v1/identify`;
  const res = await fetch(url, { method: "POST", body: form });
  const body = (await readJson(res)) as Partial<IdentifyResponse> & { error?: string };

  if (!res.ok) {
    print(`error: ${res.status} ${body.error ?? "identify failed"}`);
    return 1;
  }

  const top = body.investables?.[0];
  if (!top) {
    print("no investable brand detected");
    return 0;
  }
  const brand = top.brand;
  const q = top.quote;
  printKeyValue(
    [
      ["brand", brand.name],
      ["parent", brand.parent],
      ["sector", brand.sector],
      ["public", brand.isPublic ? "yes" : "no"],
      ["ticker", brand.ticker ? `${brand.ticker.symbol}${brand.ticker.exchange ? ` (${brand.ticker.exchange})` : ""}` : "—"],
      ["confidence", top.confidence],
      ["quote", q ? `${price(q.price)} ${q.currency} (${signed(q.change)} / ${signed(q.changePct)}%)` : undefined],
    ],
    print,
  );

  const comps = top.comparables ?? [];
  if (comps.length > 0) {
    print("");
    print("comparables:");
    for (const c of comps.slice(0, 3)) {
      print(`  ${c.ticker.padEnd(6)}  ${c.name}  score=${c.score.toFixed(2)}`);
    }
  }

  const etf = top.etfs?.[0];
  if (etf) {
    print("");
    print(`top ETF: ${etf.ticker}  ${etf.name}  weight=${(etf.weight * 100).toFixed(2)}%`);
  }

  return 0;
}

/**
 * Extension-to-MIME lookup for the common image types the API accepts.
 * Falls back to `application/octet-stream` which the API will reject
 * with a clean 415 rather than a surprising 500.
 */
function guessMime(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".heic")) return "image/heic";
  return "application/octet-stream";
}
