/**
 * Jev as the outside check on a finance agent's claim (packages/finance/src/claimVerifier.ts).
 *
 * The value-chain and comparable agents are full models. Each proposal cites one search snippet. Here
 * Jev answers one closed question per claim: does this snippet itself support this statement? It is a
 * second reading from a different model, so a citation that points at the wrong evidence is caught
 * before it is shown (AGENTS.md §2.4, §6: never fake financial data, every claim cites a real source).
 *
 * It can only remove a claim, and only when Jev is confident the snippet does not back it. No key, a
 * timeout, an error or a middling answer all return "unknown", which keeps the claim exactly as before.
 *
 * Measured (docs/JEV_CLAIM_CHECK.md, scripts/jev-claim-eval.ts). At the default, on a fresh set scored once after the
 * threshold was fixed: 0 of 20 supported claims dropped. Across all three sets 0 of 66 supported claims dropped, the
 * lowest scoring 0.16. It catches a claim whose cited snippet names none of what is claimed (6 of 6 such AMD edges, 27 of 27
 * swapped-evidence claims) and misses subtle ones, where the snippet covers the category but not the named company
 * (0 of 3 such natural cases). A claim it drops can still be true in the world: it is dropped because the snippet it cites
 * does not say it. Jev's score varies run to run (median 0.05).
 */
import type { ClaimCheck, ClaimVerdict, ClaimVerifier } from "@mapvest/finance";
import { askJev } from "./jev-client.js";

/** Below this probability of "yes" the claim is dropped. 0.2 was fixed on tuning data; a held-out true claim scored 0.16-0.22, so it is 0.1. */
export const CLAIM_MIN_YES_DEFAULT = 0.1;
/** At or above this the claim is called supported (only for logging; unknown and supported both keep it). */
export const CLAIM_SUPPORTED_YES = 0.5;
/** Requests in flight at once, and the whole batch's budget; claims not asked in time stay "unknown". */
const CONCURRENCY = 6;
const DEADLINE_MS = 5_000;

export const CLAIM_INSTRUCTIONS =
  "Does the evidence text itself say or clearly imply the statement? Answer yes only if the evidence supports it. A statement that may be true in the real world but is not backed by this evidence text is NO.";

export function claimMinYes(env: Record<string, string | undefined> = process.env): number {
  const text = (env.JEV_CLAIM_MIN ?? "").trim();
  if (!text) return CLAIM_MIN_YES_DEFAULT; // Number("") is 0, which would silently turn the check off
  const raw = Number(text);
  return Number.isFinite(raw) && raw >= 0 && raw <= 0.5 ? raw : CLAIM_MIN_YES_DEFAULT;
}

/** Off with JEV_CLAIM_CHECK=off. Without JEV_API_KEY every answer is "unknown" anyway. */
export function claimCheckEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.JEV_CLAIM_CHECK !== "off";
}

/** PURE. One Jev "yes" probability to a verdict. */
export function verdictFromYes(yes: number, minYes: number = CLAIM_MIN_YES_DEFAULT): ClaimVerdict {
  if (!Number.isFinite(yes)) return "unknown";
  if (yes < minYes) return "unsupported";
  if (yes >= CLAIM_SUPPORTED_YES) return "supported";
  return "unknown";
}

export const jevClaimVerifier: ClaimVerifier = async (claims) => {
  const out: Record<string, ClaimVerdict> = {};
  for (const c of claims) out[c.id] = "unknown";
  if (!claimCheckEnabled() || !process.env.JEV_API_KEY || claims.length === 0) return out;

  const minYes = claimMinYes();
  const deadline = Date.now() + DEADLINE_MS;
  const queue: ClaimCheck[] = [...claims];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      if (Date.now() >= deadline) return;
      const res = await askJev(
        {
          statement: c.statement,
          evidence: { title: c.evidence.title, snippet: c.evidence.snippet },
        },
        { q: { type: "noul", instructions: CLAIM_INSTRUCTIONS } },
      );
      if (!res.ok) continue;
      const a = res.answers.q;
      if (a && a.type === "noul") out[c.id] = verdictFromYes(a.noul, minYes);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, claims.length) }, worker));
  return out;
};
