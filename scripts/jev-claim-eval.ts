#!/usr/bin/env bun
/**
 * scripts/jev-claim-eval.ts
 *
 * Reproduces the measurement behind the Jev claim check (apps/api/src/lib/evidence-verifier.ts):
 * for each real claim in packages/finance/tests/fixtures/claim-verifier-eval.json, ask Jev the production
 * question and report how often it keeps supported claims and drops unsupported ones.
 *
 * Usage:
 *   JEV_API_KEY=... bun run scripts/jev-claim-eval.ts [--threshold 0.2]
 *
 * Without JEV_API_KEY it exits 0 with a message and makes no request, like jev-candidate-scan.ts.
 *
 * Two kinds of unsupported claims are scored. Real ones are in the fixture (labelled U). Synthetic ones are
 * built here from the DEV set only: the relation flipped, and the statement paired with another subject's
 * snippet. The held set showed the first threshold was too tight, so only the fresh set is a clean check of the default. Labels were made by Claude
 * reading the snippet (see _meta in the fixture): a first outside reading, not ground truth.
 */
import { readFileSync } from "node:fs";
import {
  CLAIM_INSTRUCTIONS,
  CLAIM_MIN_YES_DEFAULT,
} from "../apps/api/src/lib/evidence-verifier.js";
import { askJev } from "../apps/api/src/lib/jev-client.js";

type Claim = {
  set: "dev" | "held" | "fresh";
  kind: "edge" | "comparable";
  subject: string;
  statement: string;
  evidence: { title: string; url: string; snippet: string };
  label: "S" | "U" | "A";
};
type Item = {
  origin: string;
  set: string;
  label: string;
  statement: string;
  title: string;
  snippet: string;
};

const argT = process.argv.indexOf("--threshold");
const threshold = argT > 0 ? Number(process.argv[argT + 1]) : CLAIM_MIN_YES_DEFAULT;
if (!process.env.JEV_API_KEY) {
  console.log("JEV_API_KEY is not set: nothing asked. (Reads the fixture, makes no request.)");
  process.exit(0);
}
const fixture = JSON.parse(
  readFileSync(
    new URL("../packages/finance/tests/fixtures/claim-verifier-eval.json", import.meta.url),
    "utf8",
  ),
) as { claims: Claim[] };

const items: Item[] = fixture.claims.map((c) => ({
  origin: "real",
  set: c.set,
  label: c.label,
  statement: c.statement,
  title: c.evidence.title,
  snippet: c.evidence.snippet,
}));
const devSupported = fixture.claims.filter((c) => c.set === "dev" && c.label === "S");
const WRONG_WAY =
  /^(.*?) (supplies components or services to|is a customer of|competes with|is a partner or ecosystem complement of) (\S+?)[ .(]/;
for (const c of devSupported) {
  const m = c.statement.match(WRONG_WAY);
  if (c.kind === "edge" && m) {
    const [, who, rel, sym] = m;
    const flipped = rel?.startsWith("supplies")
      ? `${who} is a customer of ${sym} (${who} buys ${sym}'s products or services).`
      : `${who} supplies components or services to ${sym}.`;
    items.push({
      origin: "flip",
      set: "dev",
      label: "U",
      statement: flipped,
      title: c.evidence.title,
      snippet: c.evidence.snippet,
    });
  }
  const other = devSupported.find((o) => o.subject !== c.subject && o.kind === c.kind);
  if (other)
    items.push({
      origin: "swap",
      set: "dev",
      label: "U",
      statement: c.statement,
      title: other.evidence.title,
      snippet: other.evidence.snippet,
    });
}

const yes: number[] = new Array(items.length).fill(Number.NaN);
for (let i = 0; i < items.length; i += 8) {
  await Promise.all(
    items.slice(i, i + 8).map(async (it, j) => {
      const r = await askJev(
        { statement: it.statement, evidence: { title: it.title, snippet: it.snippet } },
        { q: { type: "noul", instructions: CLAIM_INSTRUCTIONS } },
      );
      const a = r.ok ? r.answers.q : undefined;
      if (a?.type === "noul") yes[i + j] = a.noul;
    }),
  );
}

const rows = items
  .map((it, i) => ({ ...it, yes: yes[i] as number }))
  .filter((r) => Number.isFinite(r.yes));
console.log(
  `threshold ${threshold}: a claim is dropped when Jev's yes < ${threshold}. asked ${items.length}, answered ${rows.length}.\n`,
);
const line = (name: string, xs: typeof rows) => {
  const dropped = xs.filter((r) => r.yes < threshold).length;
  const lo = xs.length ? Math.min(...xs.map((r) => r.yes)).toFixed(2) : "-";
  const hi = xs.length ? Math.max(...xs.map((r) => r.yes)).toFixed(2) : "-";
  console.log(
    `${name.padEnd(34)} n=${String(xs.length).padStart(3)}  dropped ${String(dropped).padStart(3)}  score range ${lo}..${hi}`,
  );
};
const SET_NOTE: Record<string, string> = {
  dev: "chose the first threshold, 0.2",
  held: "showed 0.2 was too tight; no longer clean for 0.1",
  fresh: "scored once after 0.1 was fixed: the clean check",
};
for (const set of ["dev", "held", "fresh"]) {
  console.log(`-- ${set} (${SET_NOTE[set]})`);
  line(
    "supported by the snippet (kept)",
    rows.filter((r) => r.set === set && r.origin === "real" && r.label === "S"),
  );
  line(
    "unsupported, real",
    rows.filter((r) => r.set === set && r.origin === "real" && r.label === "U"),
  );
  line(
    "ambiguous (not scored)",
    rows.filter((r) => r.set === set && r.origin === "real" && r.label === "A"),
  );
  if (set === "dev") {
    line(
      "unsupported, synthetic: flipped",
      rows.filter((r) => r.origin === "flip"),
    );
    line(
      "unsupported, synthetic: swapped",
      rows.filter((r) => r.origin === "swap"),
    );
  }
}
const worst = rows
  .filter((r) => r.origin === "real" && r.label === "S")
  .sort((a, b) => a.yes - b.yes)[0];
if (worst)
  console.log(
    `\nlowest-scoring SUPPORTED claim: ${worst.yes.toFixed(2)}  ${worst.statement.slice(0, 80)}`,
  );
