# Prism (working name "ubermemo")

A prism splits one beam into its spectrum. **Prism** splits one ticker's price
into its components — macro, factor, regime, spectral, entropy, fundamental,
filing — and recombines them into bull / neutral / bear scenarios, a
recommendation with entry and exit levels, and a memo you can ask questions of.

Mapvest does not own any of that math. Prism is built and run by the sibling
service [`the-underlying-analyzer-reboot`][underlying] (Python/Flask, live on
Railway). Mapvest exposes it as `/v1/prism/*` — thin, owner-scoped proxies with
Mapvest's own auth, device identity, and generation meter in front. See
`docs/SYSTEM_DESIGN.md` **D10** for the sibling-repo boundary decision this
follows, and `docs/DATA_SOURCES.md` for the provider row.

`ubermemo` was the working name and stays a first-class alias: **every route
below is also served under `/v1/ubermemo`**, hitting the same handlers.

> Research only. Prism never submits an order and its memo text carries a
> "not investment advice" line. Mapvest renders it behind the same disclaimer.

## Routes

| Route | Metered | Notes |
| --- | --- | --- |
| `POST /v1/prism` | ✅ `memo` | Builds the packet. 1–3 minutes cold. |
| `GET /v1/prism/{ticker}` | — | Latest stored packet, or `404`. |
| `GET /v1/prism/{ticker}/summary` | — | Bounded agent projection. |
| `POST /v1/prism/chat` | rate-limited | One turn against the stored packet. Costs one upstream Anthropic call; capped per identity, not metered. |
| `GET /v1/prism/{ticker}/export?format=txt\|json\|pdf` | — | Streams bytes. |
| `GET /v1/prism` | — | Describes the surface; no upstream call. |

The build is the only route that carries `requireGenerationQuota("memo")` — the
same meter kind as `POST /v1/memo`, because to a user they are one memo
generation. Quota is charged only when the handler returns `< 400`, so an engine
failure does not burn a generation.

The build meter is **idempotent per ticker per UTC day**. The engine
short-circuits a non-forced build for a ticker it already built today and
returns the stored packet with `meta.cache.packet: "hit"` — no provider calls,
no Anthropic call, no cost — so charging for that would let a client polling
around a long build spend its whole free tier on cache hits. The request key is
`prism:{TICKER}:{YYYY-MM-DD}`. A `force: true` rebuild really does re-run the
engine, so it gets no key and is charged every time.

Reads, the summary, and exports of an already-built packet are free: they touch
stored bytes only.

**Chat is not free, and is not a generation.** Every turn sends the ~22k-char
packet projection plus the memo excerpt to Anthropic upstream
(`app/prism/chat.py::chat_turn`). Charging a full generation per question would
make a packet unquestionable, so instead the route requires an identity (a
signed session or `X-Device-Id` — the same identity the quota middleware meters
by) and caps turns per identity per hour (`PRISM_CHAT_LIMIT`, 30/hour), refusing
the excess with `429 prism_chat_rate_limited`. The global `rateLimit`
middleware cannot do this: its buckets are keyed by identity alone and are
already consumed by every other route the client calls.

### `POST /v1/prism`

```jsonc
// body
{ "ticker": "NVDA", "force": false, "includeMemo": true }
```

`force` recomputes even when a packet already exists for today. `includeMemo:
false` returns the quantitative packet without spending an LLM call. The
engine's own `include_memo` spelling is accepted too, so a caller holding the
upstream contract does not silently lose the flag.

A cold build runs the whole engine, so the upstream budget is **180 s**
(`PRISM_BUILD_TIMEOUT_MS`). Clients should render staged progress and may
instead poll `GET /v1/prism/{ticker}` every few seconds while it runs.

Responds with the full `PrismPacket`, verbatim.

### `GET /v1/prism/{ticker}`

The latest stored packet. `404 prism_packet_not_found` until one has been
built — the error string tells the client to `POST /v1/prism`.

### `GET /v1/prism/{ticker}/summary`

The engine's compact, prompt-sized projection of the packet. This is what
`POST /v1/agent/chat` injects as research context (below), and what a
lightweight surface can render without pulling the whole packet.

### `POST /v1/prism/chat`

```jsonc
{
  "ticker": "NVDA",
  "message": "Why is the bull case only weighted at 0.3?",
  "conversationId": "chat_9",           // optional; engine-persisted thread
  "history": [{ "role": "user", "content": "…" }]  // optional; client-held thread
}
```

Answers strictly from the stored packet, so it `404`s when nothing has been
built. The response is normalized to Mapvest's camelCase (`conversationId`,
`generatedAt`); every other engine field passes through untouched. `citations`
point back into packet sections by id, so the client can deep-link an answer to
the number it came from.

### `GET /v1/prism/{ticker}/export`

`format` is `txt` (default), `json`, or `pdf`. The engine's bytes stream through
unbuffered with the right content type and
`Content-Disposition: attachment; filename="prism-NVDA.pdf"` (an upstream
`Content-Disposition` wins when the engine sends one, since it knows the
packet's `as_of` date). `Cache-Control: private, no-store` — a packet is a
per-caller research artifact, not a public document. An unbuilt packet returns
a JSON `404`, never a truncated download.

## The packet

`PrismPacket` in `packages/core/src/schemas/index.ts` is the contract, and
`openapi.yaml` is its generated projection. Ticker, `as_of`, `generated_at`,
`engine_version`, and `meta` are always present; every analytical section is
present and **nullable**. A `null` section means "could not compute" and never
"zero" — the reason arrives as a sibling `<section>_error` string and as an
entry in `meta.errors`.

Sections, in packet order: `profile`, `universe`, `seasonality`, `macro`,
`relational`, `factors`, `regimes`, `entropy`, `spectral`, `eigen`,
`fundamentals`, `filings`, `volatility`, `levels`, `news`, `recent`,
`scenarios`, `memo`, `sources`, `meta`.

### Loose sections, two strict shapes

The analytical sections are `.passthrough()`. The engine keeps every
intermediate result in the packet on purpose — so the chat can cite it — and it
grows. A client that broke on a new key would break on every engine release.

Two shapes are `.strict()`, because a client renders them as a contract
rather than as data:

- **`memo.recommendation`** — the action grammar:
  `action ∈ {strong_buy, buy, hold, sell, strong_sell}`,
  `strength ∈ {strong, normal, weak}`, `conviction ∈ [0,1]`, `one_line`.
  The engine validates `action` and `strength` against its own enums before
  emitting them and clamps `conviction` to `[0,1]`, so this gate holds.
- **`scenarios.cases`** — exactly `bull`, `neutral`, `bear`. `probability` is
  nullable inside a case: the engine reads it off the mixture block for the
  packet's `probability_horizon` and returns `null` rather than inventing a
  number when no component forecast survived there.

**`meta` was a third strict shape and is now `.passthrough()`.** Integration
against a live packet showed it is bookkeeping, not a contract: `empty_meta()`
also emits `unavailable` and `notes`, the engine appends a `stored` record from
`store.save_packet()`, and the series cache writes numeric `cache.hits` /
`cache.misses` next to the `hit`/`miss` strings. The four documented keys stay
pinned; everything else passes through.

The proxy **does not validate** upstream packets. A strict gate at the API
boundary would turn an engine schema addition into a `502` for every client;
instead the packet passes through verbatim and a strict-shape drift surfaces as
a client-side `safeParse` failure the client can degrade around. If one of the
two strict shapes has to change, change it here and in the engine together.

### Nullability, verified against real packets

Fields that look mandatory in the plan's contract are nullable in practice, and
the schemas say so. Each of these was found by parsing an actual engine packet,
not by guessing:

- `profile.sector` / `industry` / `description` — `null` for a fund or index.
- `sources[].url` — `null` when the row is an API call, not a document;
  `sources[].confidence` is a number on most rows and a label on others.
- `memo.model` and `chat.model` — `null` when the deterministic fallback ran
  (no `ANTHROPIC_API_KEY`), in which case chat replays the stored memo.
- `memo.citations[].url` — `null` for a citation into a packet section.
- `memo.exit_targets[].price` / `probability` — optional as well as nullable,
  because the memo may pass the model's own `exit_targets` through verbatim.

### The summary projection has no `text` key

`GET /v1/prism/{ticker}/summary` returns
`app/prism/engine.py::prism_summary()` — a nested object, not prose. The memo
text arrives as `memo_excerpt` (1500 chars) and the thesis as `one_line`.
`renderPrismSummary()` in `lib/prism.ts` therefore flattens the projection into
labelled lines (recommendation, scenario split, entry band, timing, regime,
3-month entropy, unavailable sections) before it is injected into a research
prompt; a raw `JSON.stringify` is only the last-resort path for a projection
shaped differently than expected.

### Provenance

Every packet carries `sources: PrismSourceRef[]` (`provider`, `url`,
`fetched_at`, `confidence`) and lists what it could not reach in `meta.errors`
and `meta.source_status`. `PrismSourceRef.provider` is a free string, not
Mapvest's `Source.provider` enum: the engine names its own upstreams
(`massive`, `fred`, `sec`, `exa`, `anthropic`) and Mapvest passes them through
rather than remapping into an enum it does not own. Nothing is ever
zero-filled — AGENTS.md §2.4.

## Errors

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `prism_bad_request` | Bad ticker, message, or `format` — rejected locally, no upstream call. |
| 402 | `quota_exceeded` | Free-tier generation meter spent (build only). |
| 404 | `prism_packet_not_found` | No packet for this ticker yet. |
| 429 | `prism_chat_rate_limited` | Per-identity chat turn cap spent; `Retry-After` is set. |
| 429 / 503 | `prism_busy` | Engine back-pressure; `Retry-After` is forwarded. |
| 502 | `prism_upstream_failed` | Engine 5xx/401/403 — a Mapvest↔engine problem, deliberately not shaped like a caller error. |
| 504 | `prism_timeout` | The engine did not answer inside the budget. |

## Research-chat pre-load

When `POST /v1/agent/chat` (or `/v1/agent/stream`) is called **with a ticker**,
the API fetches `GET {UNDERLYING_URL}/api/prism/{ticker}/summary` best-effort
and injects it into the Derivation research prompt as context, before the
`\n\nUser: ` marker so it never appears in the displayed transcript.

The contract, enforced by `prismSummaryForPrompt` in `apps/api/src/lib/prism.ts`
and covered by `apps/api/tests/prism.test.ts`:

- **3 s budget**, one attempt, no retry.
- **Cached both ways** per normalized ticker — a hit for 5 minutes, a miss (404,
  timeout, unreachable engine) for 60 seconds. Without the negative half, every
  turn of a conversation about an unbuilt ticker pays a fresh round trip to
  learn the same 404. `__resetPrismSummaryCache()` clears it in tests.
- It **never throws**. A missing packet — the common case, since most tickers
  have never been built — a slow engine, or an unconfigured `UNDERLYING_URL`
  all yield `undefined`.
- With `undefined`, the prompt is **byte-identical** to the pre-Prism shape.
- The injected text is capped at 6 000 chars so a packet cannot crowd out the
  turn.

A research turn must never fail because a memo packet was unavailable.

## Configuration

| Var | Default | Purpose |
| --- | --- | --- |
| `UNDERLYING_URL` | `https://underlying-terminal-production.up.railway.app` | Origin of the Prism engine. Shared with the other Underlying proxies (`/v1/chart`, `/v1/analysis`, `/v1/memo`). Read once at module load. |

No Prism-specific secret crosses this boundary: the engine holds its own
Massive / FRED / SEC / Exa / Anthropic credentials in its own Doppler project.

## Tests

```
bun test apps/api/tests/prism.test.ts   # 54 tests, fetch fully stubbed
```

The suite covers the schema posture (loose sections survive a new engine field;
the two strict shapes reject drift), the upstream client helpers (ticker
normalization including `X:BTCUSD` / `C:EURUSD`, snake_case → camelCase chat
normalization, the 180 s and 3 s budgets), every route including the
`/v1/ubermemo` alias and the export byte stream, the metering posture (a build
charges once per ticker per day; a forced rebuild always charges; a failed build
charges nothing; reads and exports are free; chat is capped per identity), the
summary cache's positive and negative halves, and the research-chat pre-load's
never-block guarantee.

[underlying]: https://github.com/jawauntb/the-underlying-analyzer-reboot
