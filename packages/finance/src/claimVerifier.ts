/**
 * A cheap second reading on a model's claim, from outside the model that made it.
 *
 * The value-chain and comparable agents (a full model) propose edges and tickers from search
 * evidence. Each proposal cites one evidence item. A verifier answers one closed question per
 * claim: does this snippet support this statement, yes or no? Jev (apps/api/src/lib/evidence-verifier.ts)
 * is the verifier in production; this package never imports apps/*, so it takes the verifier as a
 * function.
 *
 * Contract (AGENTS.md §2.4, never fake financial data): a claim the verifier calls unsupported is
 * dropped. Everything else is kept exactly as before: no verifier, a failure, a timeout, a low
 * confidence answer and a claim with nothing to check against all come back "unknown" and pass.
 * The verifier can only remove an edge, never add one or change one.
 */

export type ClaimEvidence = { title: string; url: string; snippet: string };

export type ClaimCheck = {
  /** Unique inside one batch. */
  id: string;
  /** One plain sentence the evidence should support. */
  statement: string;
  evidence: ClaimEvidence;
};

export type ClaimVerdict = "supported" | "unsupported" | "unknown";

/** Answers every claim in one call. Missing ids count as "unknown". Must not be trusted to throw nothing. */
export type ClaimVerifier = (claims: ClaimCheck[]) => Promise<Record<string, ClaimVerdict>>;

/** A snippet shorter than this carries too little to check a claim against. */
export const MIN_CHECKABLE_SNIPPET = 40;

export function checkable(evidence: ClaimEvidence | undefined): evidence is ClaimEvidence {
  return !!evidence && evidence.snippet.trim().length >= MIN_CHECKABLE_SNIPPET;
}

/** Never throws. Anything but a clean "unsupported" or "supported" per id is "unknown". */
export async function verifyClaims(
  claims: ClaimCheck[],
  verify?: ClaimVerifier,
): Promise<Record<string, ClaimVerdict>> {
  const out: Record<string, ClaimVerdict> = {};
  for (const c of claims) out[c.id] = "unknown";
  if (!verify || claims.length === 0) return out;
  try {
    const got = await verify(claims);
    for (const c of claims) {
      const v = got?.[c.id];
      if (v === "supported" || v === "unsupported") out[c.id] = v;
    }
  } catch (err) {
    console.warn("[finance] claim verifier failed, keeping every claim:", err);
  }
  return out;
}

/**
 * Verifies the claims of staged items in one batch and keeps every item the verifier did not call
 * unsupported. Items without a check (nothing to check against) are always kept.
 */
export async function keepSupported<T>(
  staged: { item: T; check?: ClaimCheck }[],
  verify?: ClaimVerifier,
): Promise<T[]> {
  const checks = staged.flatMap((s) => (s.check ? [s.check] : []));
  const verdicts = await verifyClaims(checks, verify);
  return staged
    .filter((s) => !s.check || verdicts[s.check.id] !== "unsupported")
    .map((s) => s.item);
}

/** The statements, one per edge type, FROM the counterparty TOWARD the symbol (as the judge prompt defines them). */
export function edgeStatement(
  symbol: string,
  counterparty: string,
  relation: string,
): string | null {
  switch (relation) {
    case "supplies":
      return `${counterparty} supplies components or services to ${symbol} (${counterparty} is a supplier or vendor of ${symbol}).`;
    case "buys_from":
      return `${counterparty} is a customer of ${symbol} (${counterparty} buys ${symbol}'s products or services).`;
    case "competes_with":
      return `${counterparty} competes with ${symbol}.`;
    case "complements":
      return `${counterparty} is a partner or ecosystem complement of ${symbol} (its products make ${symbol}'s products more valuable).`;
    default:
      return null;
  }
}

export function comparableStatement(brand: string, name: string, ticker: string): string {
  return `${name} (${ticker}) is a publicly traded company that is a close competitor of, or the parent or IP licensor of, ${brand}.`;
}
