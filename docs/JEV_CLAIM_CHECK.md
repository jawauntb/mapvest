# Jev claim check

A second reading on what the finance agents propose, from a different model, before it is shown.

## What it does

`extractValueChain` (value-chain edges) and `resolveComparable` (private brand to public comparable) ask a full
model to propose edges and tickers from Exa evidence. Each proposal cites one evidence snippet. For every proposal that
cites a web snippet, Jev answers one closed question: **does the evidence text itself say or clearly imply the
statement?** If Jev is confident the answer is no (probability of yes below `JEV_CLAIM_MIN`, default **0.1**), the
proposal is dropped. Nothing is ever added or changed.

- Code: `packages/finance/src/claimVerifier.ts` (the contract, no Jev import: packages never import apps),
  `apps/api/src/lib/evidence-verifier.ts` (Jev as the verifier), wired in `routes/graph.ts`, `identify.ts`,
  `resolve.ts` and `rivalries.ts`. Not in `watchlist.ts`: its 3.5 s timeout race cannot absorb the extra latency.
- One small `systemone` request per claim (state: the statement and the snippet's title and text, never the URL),
  six at a time, a 5 s budget for the batch.
- **Fails open.** No `JEV_API_KEY`, `JEV_CLAIM_CHECK=off`, an HTTP error, a timeout, a middling answer, a filing
  citation (no text to check) or an uncited pick: the claim stays exactly as before.
- Env: `JEV_CLAIM_CHECK=off` (kill switch), `JEV_CLAIM_MIN` (0 to 0.5).

## What the measurement says

`bun run scripts/jev-claim-eval.ts` (needs `JEV_API_KEY`) asks Jev the production question about 59 + 26 real claims
captured from the real pipeline on 2026-10-16 (`packages/finance/tests/fixtures/claim-verifier-eval.json`), plus
synthetic unsupported claims built from the tuning set. Labels are Claude's reading of each snippet, made before any Jev
score was seen. They are not human labels.

| | dev (tuned 0.2) | held (showed 0.2 too tight) | fresh (clean check of 0.1) |
|---|---|---|---|
| supported by the snippet, dropped at 0.1 | 0 of 27 | 0 of 19 | **0 of 20** |
| unsupported, real, dropped at 0.1 | 0 of 1 | 6 of 6 | 0 of 2 |
| unsupported, synthetic: swapped evidence | 27 of 27 | | |
| unsupported, synthetic: flipped relation | 8 of 18 | | |

What that supports, and what it does not:

- It removes a claim whose cited snippet names none of what is claimed. All 6 such real AMD edges (TSMC, GlobalFoundries,
  UMC, Amkor, Broadcom, Qualcomm, each citing a 10-K excerpt that names none of them) and every swapped-evidence claim.
- It does **not** catch the subtle case, where the snippet covers the category but not the named company
  (Monster for Red Bull, SharkNinja for Dyson, LVMH for Rolex: 0 of 3). Jev scored those 0.2 to 0.6.
- It is **weak on a flipped relation** (supplier labeled as customer): about half.
- **A dropped claim can be true in the world.** TSMC does supply AMD; the edge goes because the snippet it cites
  does not say so. That is what AGENTS.md §6 asks (every edge ties to a real evidence URL), and it also lowers recall
  when retrieval is thin. If the graph looks too sparse, set `JEV_CLAIM_CHECK=off` or lower `JEV_CLAIM_MIN`.
- The margin on true claims is thin: two of 66 supported claims scored under 0.2 (La-Z-Boy 0.16 to 0.22,
  Tata Play 0.15 to 0.16). Jev's score for one claim moves between runs (median 0.05, up to 0.16). The true-drop rate in the
  wild is therefore small but not zero, and was 0 of 66 at the default in the runs above.
- n is small (85 real claims, 3 sets) and the labels are one model's. The threshold history is in the fixture's `_meta`:
  0.2 was fixed on dev, the held set then showed a true claim near it, so the default became 0.1, and only the fresh set
  was scored after that.

## Reading Jev's own opinion of a call site

`scripts/jev-candidate-scan.ts` asks Jev which LLM call sites fit it. Its answers are a prompt for human review: in
`option_derivation` the same scan rated every call site good_fit at 0.12 to 0.22 confidence, including open-ended
drafting. This check was added because a call site is a good fit when the question is closed (here: yes/no against given
text), not because Jev said so.
