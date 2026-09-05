# Situate

Situate is the single-name research engine that **reforms Prism**. Where Prism
splits a ticker into a dozen components and recombines them into a buy/sell
recommendation, Situate answers a narrower, more honest question: given ticker
`T` on date `t`, and horizons `h ∈ {1, 2, 3, 6, 12, 18}` months, what is the
conditional forward-return **distribution**, and what does the memo call it?

It is **not** a price forecaster. There is no buy/sell grammar and no point
price target anywhere in the packet. The call is a **posture** — *odds
favorable*, *balanced*, or *odds unfavorable* at a horizon — plus cheap/rich
**zones** and a distribution with a **base rate beside every conditional
number**.

The engine lives in the sibling `underlying-analyzer-reboot` service under
`/api/situate/*`. Mapvest owns no Situate math — `apps/api/src/lib/situate.ts`
is the whole boundary and forwards to the engine through `UNDERLYING_URL`.
Situate is **additive**: Prism (`/v1/prism`, `/v1/ubermemo`) stays in place and
keeps working.

## Routes

Mounted at `/v1/situate` and, identically, at the neutral alias `/v1/research`.

| Method | Path | Cost | Notes |
| --- | --- | --- | --- |
| `POST` | `/v1/situate` | **1 generation** (`memo`) | Build (or return today's stored) packet. Body `{ ticker, force?, includeMemo?, asOf? }`. A cold build is 1–3 minutes (180s upstream budget); render staged progress and poll the read route. Metered idempotently per `ticker`+day (+`asOf`) so cache hits and polling are free; `force: true` always spends. |
| `GET` | `/v1/situate/{ticker}` | free | Latest stored packet; `404` (`situate_packet_not_found`) until one is built. Clients poll this while the build runs. |
| `GET` | `/v1/situate/{ticker}/summary` | free | Bounded agent projection (prompt-sized). `POST /v1/agent/chat` pre-loads it best-effort (3s) as research context, **preferred over the Prism summary**. |
| `POST` | `/v1/situate/chat` | capped/identity | One turn answered strictly from the stored packet, with citations back into modules. Not a generation, but capped at 30 turns/identity/hour (it spends one upstream completion). |
| `GET` | `/v1/situate/{ticker}/export?format=txt\|json\|pdf` | free | Streams the engine's rendering with `Content-Disposition: attachment` for a share sheet. |

Error codes: `situate_bad_request` (400), `situate_packet_not_found` (404),
`situate_busy` (429/503, forwards `Retry-After`), `situate_timeout` (504),
`situate_upstream_failed` (502). An engine 401/403/500 collapses to 502 so an
engine-side fault never looks like a caller error, exactly as with Prism.

## The packet

The zod contract is `SituatePacket` in `packages/core/src/schemas/index.ts`.
Posture, deliberately mixed (mirrors `PrismPacket`):

- **Loose** (`.passthrough()`) for every analytical section — `exposure`,
  `state`, `base_rates`, `implied`, `fundamentals`, `text`, `levels`, `stack`,
  `scenarios`. The engine grows these; a client must not break on a new key.
  Each is `null` when it could not be computed, with a sibling
  `<section>_error` string carried through by the packet passthrough. **A `null`
  section means "could not compute", never "zero"** — the iOS dashboard renders
  every section, and a null one says "unavailable: <reason>".
- **Strict** for the two shapes a client renders as a contract:
  `memo.posture` (the posture grammar — never buy/sell) and each `odds`
  horizon entry (the merged distribution the memo reads).
- `meta` pins its documented bookkeeping keys (`errors`, `unavailable`,
  `source_status`, `timings_ms`, `versions`, `cache`) and passes the rest
  through — a strict gate here rejected every real Prism packet, and Situate is
  bookkeeping the same way.

Numbers are **decimal fractions** for returns (`0.034` = 3.4%). Dates are ISO.
The Mapvest proxy passes the packet through **verbatim** and does not
re-validate the analytical sections, so a schema addition upstream never 502s a
client — the zod contract in `packages/core` is what clients parse against.

### Sections at a glance

| Section | What it holds |
| --- | --- |
| `exposure` | EWMA-ridge betas on a basket (SPY, sector/industry ETF, size, FX, oil, gold, rates, credit, vol), bootstrap SE, R², idiosyncratic share, residual vol, a named Fama-French factor view, and 6/12-month **change**. |
| `state` | 2×2 vol×trend cell for SPY and the ticker, an optional 3-state HMM second opinion, and VIX / HY-OAS / curve percentiles as context. |
| `base_rates` | Per-horizon empirical forward-return quantiles — unconditional, conditioned on the current cell, and the **shrunk** blend with its weight `w` and `n_eff = n/h`. |
| `implied` | Per-horizon options-implied quantiles from a smile fit + Breeden-Litzenberger density, ATM IV, 25Δ skew, P(±10/±20%), and `width_ratio_vs_hist`. Degrades per-horizon to `null` on thin chains. |
| `fundamentals` | 12-1 momentum, 1-month reversal, quality (gp/assets, accruals, net-debt/EBITDA, coverage), value z-scores, and an 8-quarter trajectory keyed on filing date. `revisions`/`pead` are `null` — Massive has no estimates endpoint. |
| `text` | Filing diffs per section (change score + new/removed risks with quotes + material-change score) and dated news events with sentiment. LLM output is evidence, never a numeric forecast input. |
| `levels` | POC/VAH/VAL, 20/50/200-day MAs, and cheap/rich price zones = the price at the 25th/75th implied quantile. |
| `stack` | A validated cross-sectional ridge — published only if OOS IC and Deflated-Sharpe gates pass; otherwise `published: false` + reason, and `odds` falls back to base_rates + implied. |
| `odds` | The merged forward-return distribution the memo reads, per horizon: `source`, `quantiles`, `p_up`, `base_rate_q50`, `shrink_w`. |
| `memo` | Markdown write-up, the strict `posture`, three `falsifiers`, `key_determinants`, `whats_priced_in`, `citations` (module + version), and `zones`. "The data suggests" phrasing; a not-investment-advice line; no order, ever. |

## iOS

The dashboard is `apps/ios/app/situate/[ticker].tsx`, built on section
components in `apps/ios/src/situate/*` and Atlas-Signal charts in
`apps/ios/src/chartkit/situate/*`. It renders: exposure bars with 12-month
change; a 2×2 state grid with the HMM chip and macro context; a horizon
quantile fan with implied vs historical overlaid and a P(up) row; a
what's-priced-in panel; a business panel; cheap/rich zones on a price ladder;
scenarios; the memo (serif) with a posture chip, conviction meter, falsifiers,
and citations; a confidence/caveats card (n_eff, shrink w, gate status, data
gaps); a chat composer; and txt/pdf export. Every section renders
"unavailable: <reason>" when its packet section is null. The build is slow, so
the screen shows staged progress and polls `GET /v1/situate/{ticker}` every 5s.

The ticker detail sheet's research action opens `/situate/{ticker}` as the
**primary** research entry; the Prism button remains as a secondary path.

## Research-agent context

`POST /v1/agent/chat` fetches both the Situate and Prism summaries concurrently
(best-effort, 3s each, both cached). Situate's is **preferred** when present and
injected before the user marker as evidence the agent may cite as "Situate";
the Prism block is the fallback for a ticker that only has a Prism packet. When
neither exists the prompt is byte-identical to the pre-packet shape.

Research only. Not investment advice. Situate never places orders, never says
buy or sell, and never prints a point price target.
