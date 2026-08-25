# Universe Roadmap — gamification + layered analysis

Plan of record for two workstreams that share one loop: making the universe
(the finds journal) a game people return to daily, and making Mapvest able to
analyze a company from first principles by modeling the layers around it.
Nothing here is built yet. Each slice below is one PR, one concern, with an
acceptance gate, per `AGENTS.md` §9.

The north star: **discover → understand → payoff.** You point the camera at a
storefront and catch a company. The app helps you learn how that business
works. Then it shows you what noticing it early was worth. Every slice in this
document feeds one of those three beats or it doesn't ship.

---

## 0. Current state (what this plan builds on)

What exists today, precisely:

- **The catch mechanic already works.** Every authenticated `/v1/identify`
  records a `Find` — brand, ticker (or private→comparable), confidence,
  optional lat/lng, and `found_price` captured at the moment of capture
  (`apps/api/src/routes/identify.ts`, `apps/api/src/lib/finds-store.ts`).
  The journal is unique by effective ticker (recatch still bumps streak/XP).
- **The journal and map layer exist.** `apps/ios/app/universe.tsx` shows
  Δ% since found per find; `apps/ios/app/(tabs)/map.tsx` renders geo-tagged
  finds as jade camera badges.
- **The only engagement mechanic is a streak**, computed client-side in
  `apps/ios/src/api/finds.ts` (`findStreakDays`), display-only.
- **Notification infra is real**: `apps/api/src/lib/scheduler.ts` ticks every
  minute; notifiers in `apps/api/src/lib/notifiers/` with per-user dedupe;
  `push_tokens.prefs` JSONB carries opt-ins plus `last_lat`/`last_lng` and
  fires a local brief when the user moves >2km. Notification consent is
  explicit: a signed-in launch never prompts iOS, and Settings is the only
  permission request surface. Each device persists a product-level
  `notifications_enabled` mute independent of OS authorization; every
  notifier, including weekly rivalries, honors it.
- **Collection structure is latent in the data**: `packages/finance/data/brands.json`
  (1,101 brands with sector/exchange/isPublic), geohash-6 tiling in
  `apps/api/src/lib/geohash.ts` + `nearby_cache`.
- **The comparables engine** (`packages/finance/src/comparable.ts`) already
  does Exa evidence → LLM judge → ≤3 cited tickers.
- **Filings are proxied, not first-party**: `/v1/memo/sec/:ticker` and
  `POST /v1/memo` forward to the sibling `underlying-terminal` service.
  Massive income-statement / balance-sheet / cash-flow endpoints are available
  but not wired (`docs/MARKET_DATA_MIGRATION.md`).

Two known defects this plan absorbs:

1. `moverNotifier.ts` says "it's in your universe" but scans the
   **watchlist**, not finds.
2. The Local Economy Brief goes stale on foreground: arrive at work and the
   card still shows the brief for home until a manual refresh, even though
   the brief cache is already keyed by location.

---

## 1. Workstream A — Universe gamification

Pokémon Go's loop, mapped onto what the catch mechanic already records. The
two behaviors every slice must drive: point the camera more, reopen the app
daily. XP is the single currency; levels gate cosmetics only, never features —
free-tier progression must not fight the paywall.

### A1 — Server-side progression store + real streak

- [x] `user_progress` store next to `finds-store.ts` (same lazy-DDL +
      in-memory-fallback pattern): xp, level, streak count, streak-freeze
      inventory, last-find day.
- [x] Move streak computation server-side; update on `recordFind`. Client
      reads it instead of deriving it.
- [x] Streak milestones (7/30/100 days) and streak freezes.
- [x] Schemas in `packages/core`, `bun run openapi && bun run postman`.

**Acceptance**: streak survives reinstall (server truth); `bun test` covers
the store's memory path; the journal header reads from the API.

### A2 — Evolution notifier (and fix the mover copy)

A find "evolves" at +10% / +25% / +50% / +100% since `found_price`. This is
the return loop that needs no new catch — you open the app because something
you physically discovered got more valuable on its own.

- [x] `findEvolutionNotifier` beside `moverNotifier`: scan `user_finds`
      against current quotes, existing dedupe store, one evolution push per
      find per tier ever.
- [x] Push copy is personal, spatial, time-anchored: "The Chipotle you spotted
      on Valencia St is up 26% since you found it."
- [x] Fix `moverNotifier` copy or retarget it at finds — "it's in your
      universe" must be true.
- [x] Journal rows + map badges get tier rings (bronze/silver/gold).

Framing rule: an evolution is a **collection event, not a buy signal**. Copy
never says buy/sell/should. This keeps the game clean and keeps us out of
advice territory.

**Acceptance**: a find crossing +10% produces exactly one push; re-crossing
produces none; copy contains brand + place + Δ since found.

### A3 — Counterfactual universe portfolio

The single highest-value retention artifact per unit of effort in this plan.

- [x] One aggregate number from data we already store: "If you'd put $100
      into every find at the moment you found it, your universe would be
      worth $X." Server-computed from `found_price` vs current quotes.
- [x] Rendered at the top of `universe.tsx` and on Home. Shareable.

**Acceptance**: number matches hand-computed value for a seeded user;
finds without `found_price` are excluded, not faked (AGENTS §2.4).

### A4 — The Dex (collection structure + rarity)

- [x] Sector dexes derived from `brands.json`: "Consumer Staples — 14/89
      found," ring per sector (reuse `SectorRing` chrome).
- [~] Rarity tiers from data we have: public mega-cap = common; small-cap =
      uncommon; private-via-comparable = rare; not-in-`brands.json` but
      resolved by the vision pipeline = legendary — and that catch feeds the
      seed table. Users become the data flywheel.
- [x] Regional dex: distinct geohash-6 tiles with ≥1 find.
- [x] Completion badges write XP to `user_progress`.

**Acceptance**: dex counts reconcile with `user_finds` × `brands.json`;
catching a new-to-seed brand surfaces a "legendary" state.

### A5 — Daily quests

- [x] Quest generator over verifiable actions only: identify a private brand,
      find in a never-visited tile, fill an empty sector.
- [x] Quest completion grants XP; optionally grants identify credits to free
      users (engagement mechanic and monetization funnel in one).
      (XP only — idempotent per quest id via `awardXp`. The optional
      identify-credit grant was deliberately not built.)

**Acceptance**: quests verify server-side from the find stream; no
self-reported completion.

### A6 — Territory

- [x] "Pioneer" bonus: first find in a geohash tile.
- [x] Neighborhood completion: "6 of 11 investable brands found in this tile"
      via the nearby cascade.
- [x] Add a geohash column (or index) to `user_finds` for tile queries.

**Acceptance**: tile completion count matches `/v1/nearby` investables for
that tile.

### A7 — Events

- [~] Scheduler-driven quest modifiers: Sector Saturday (2× XP for a sector),
      earnings-week events from corporate-events data.
      (Sector Saturday ships and its multiplier is applied in
      `progress-store.ts`, but the window is derived from the clock on
      read — there is no scheduler row. Earnings-week events are not
      built: they need the Massive corporate-events feed, which is off
      by default via `MASSIVE_CORPORATE_EVENTS_ENABLED=0`.)

**Acceptance**: event window opens/closes on schedule; XP multiplier applies
only inside it.

**Deliberately not building**: PvP battles, leaderboards, or any social graph
in this phase. Pokémon Go shipped without social too. See §3 for the solo
"battle" that does fit.

---

## 2. Workstream B — Location engine

The stale-brief complaint is two problems with different costs. In-app
staleness needs no background machinery. Background awareness is what makes
the catch-nearby push possible.

### B1 — Foreground brief refresh (ship first, it's a bug fix)

- [x] `LocalEconomyBriefCard` compares its brief's coordinates to the current
      fix on app foreground; >2km apart → refetch (the cache is already keyed
      by rounded lat/lng — a new location is a new brief).

**Acceptance**: simulate Astoria → Flatiron; card refreshes on foreground
without manual action.

### B2 — Uncaught silhouette pins

The mechanic made visible without any push or permission.

- [x] On the map, nearby investables **not** in the user's finds render as
      grayed silhouette pins beside the jade finds layer.

**Acceptance**: catching a silhouetted brand flips its pin to jade on next
map load.

### B3 — Widget location heartbeat

Roughly-hourly background location with **no new permission ask**.

- [~] Widget requests location under the existing When-In-Use grant
      (`NSWidgetWantsLocation`); each timeline refresh POSTs the fix to the
      existing heartbeat (`push_tokens.prefs.last_lat/last_lng`).

**Acceptance** (DEFERRED — needs `expo prebuild` + a device build): with the
app closed and widget installed, server sees fixes move during a normal day.
The Swift heartbeat, the `NSWidgetWantsLocation` plist and the app-side
relay (`syncWidgetFixIfFresh`, wired into `PushBridge` in `app/_layout.tsx`)
are all in the tree and inert until that build.

### B4 — Arrival push: uncaught-nearby with scoring

The strongest engagement surface in this plan. Not hourly summaries —
arrival-triggered collection gaps: "JPM is 200m away and it's not in your
universe."

- [x] Notifier on the existing >2km move trigger: heartbeat location → nearby
      cascade → investables minus `user_finds` minus watchlist = uncaught set.
- [x] Score candidates before pushing: personal affinity (sectors the user
      catches/watchlists, `usage_events`), dex value (fills an empty sector,
      first-in-tile, rarity), timeliness (moved today, earnings this week),
      novelty (never pushed — dedupe store).
- [x] **Budget discipline is a hard rule**: max one push per arrival, max two
      per day, threshold-gated, silent otherwise. A mediocre daily ping
      trains users to swipe away the great ones.
- [~] Push opens the map with the uncaught pin highlighted.
      (The push carries `ticker`/`lat`/`lng` and a tap now routes through
      `notif/router.ts` to that company's detail page. The map screen takes
      no deep-link params yet, so nothing is highlighted on it.)

**Acceptance**: seeded user in a new tile with a high-scoring uncaught ticker
gets exactly one push; same tile next hour gets none.

### B5 — Always-permission visit monitoring (power users)

- [x] `CLVisit` / significant-location-change via expo-location + TaskManager
      for home→work-grade arrival detection at near-zero battery.
- [x] Ask for Always **only after** the user has felt B4's value from the
      widget path — never at onboarding.
      Settings shows the Always toggle only after `uncaught_nearby` is on.
      `app.json` ships `UIBackgroundModes: ["location"]`, the Always usage
      strings, and `isIosBackgroundLocationEnabled` in the same change.

**Acceptance** (DEFERRED — needs `expo prebuild`, a device build, and an
Always grant): arrival at a recurring location fires the B4 pipeline with
the app killed.

---

## 3. Workstream C — The company graph (layered analysis)

The analytical model: a company sits in a stack —

```
suppliers → COMPANY → buyers
     ↕ competitors & complements (lateral)
        sector / industry
        macro · fiscal · monetary
        culture · policy · region
```

The first four are **edges between companies**. The rest are **fields** the
graph sits in. Modeled that way, the analysis feature and the game are the
same feature: catching NVDA reveals its constellation (TSMC upstream, MSFT
downstream, AMD lateral) as visible-but-uncaught nodes. The universe gets a
second map — economic space beside geographic space.

Synthesis is the goal: an NVDA analysis that has TSMC's capacity and MSFT's
capex in context is categorically better than one that only reads NVDA's own
filing. The layers exist to make that memo possible.

### C1 — `company_edges` store + extraction pipeline

- [x] Table `company_edges` (lazy-DDL pattern): `src_ticker, dst_ticker?,
      dst_name, edge_type (supplies|buys_from|competes_with|complements),
      weight, reasoning, sources jsonb, as_of, created_at`. Refresh when a
      new 10-K lands, not on a short TTL.
- [x] `packages/finance/src/valueChain.ts`: Exa evidence (suppliers /
      customers / partners queries) + SEC citations from the sibling's
      `/api/sec/:ticker` → LLM judge (same cascade + plausible-ticker rules
      as `comparable.ts`) → cited edges. Private counterparties keep
      `dst_name` with no ticker — never invent one.
- [x] `GET /v1/graph/:ticker` — cache-first, in-flight dedupe per ticker,
      every edge carries `sources` (AGENTS §6; 10-K items 1/1A are the
      primary evidence: supplier concentration and >10% customers are
      disclosed there).
- [x] Schemas in `packages/core`; regen openapi/postman.

**Decision recorded**: keep proxying `underlying-terminal` for filings text.
Design `sources` to be provider-agnostic so a first-party EDGAR client can
slot in later without touching the graph. Do not fork filings logic into two
repos.

**Acceptance**: `GET /v1/graph/NVDA` returns supplier + buyer edges with
real tickers and sources; second call is a cache hit; junk tickers rejected.

### C2 — Orbit view + constellations

- [x] Detail page Orbit view: company centered, suppliers below, buyers
      above, comps beside; each edge taps through to its citation.
- [ ] Universe constellation view: caught nodes lit, graph-adjacent uncaught
      nodes grayed (same silhouette language as B2).
- [ ] Quests over edges: "catch 3 companies in NVDA's supply chain."

**Acceptance**: catching a constellation node lights it without refetch of
the graph.

### C3 — Demand pulse

- [x] Wire Massive income-statement / cash-flow endpoints
      (`packages/finance/src/marketData/`).
- [x] For a ticker's `buys_from` edges, aggregate buyer revenue/capex
      trajectories into one signal: is the money upstream of this company
      growing or shrinking.

**Acceptance**: NVDA demand pulse moves when constituent buyer capex series
move; pulse cites per-buyer sources.

### C4 — Environment layer

- [~] FRED provider (free API) in `marketData/` style: rates, CPI,
      sector-mapped series. Region resolved per company listing/HQ.
      (`FRED_API_KEY` is in Doppler `mapvest` + `shared` and on the Railway
      API. Series are sector-mapped; per-company region resolution is NOT
      built — every series is US national.)
- [x] Environment brief per sector: the local-brief generator shape (gather →
      Opus → Tailwinds/Headwinds → cache) at sector scale; policy/culture via
      Exa with recency filters, treated as qualitative color, never as data.

**Acceptance**: sector environment brief renders with cited series + sources;
24h cache.

### C5 — Synthesis memo

- [x] Extend `POST /v1/memo`: prompt receives the three layer briefs
      (upstream / demand / environment) + ratios, and is asked exactly:
      what is the binding constraint on this business, how durable is the
      demand above it, where in the chain does pricing power sit.

**Acceptance**: memo for a ticker with a populated graph cites at least one
upstream and one downstream fact with sources; degrades gracefully (plain
memo) when the graph is empty.

### C6 — Rivalries (bridges A and C)

The solo "battle" that fits. PvP is rejected: needs a social graph, and
drifts toward prediction-market energy that muddies "learn how the economy
works."

- [x] Pit a find against a comparable (NVDA vs AMD) as a tracked weekly
      matchup; push when the round closes with the running record.
- [x] Optional pre-registered pick for XP — a conviction game that trains
      exactly long/short pair intuition, with no positions.

**Acceptance**: weekly close computes winner from provider quotes; one push
per round; record persists in `user_progress`.

---

## 4. Cross-cutting rules

- **New per-user state** follows the `finds-store.ts` pattern; small flags
  ride `push_tokens.prefs` JSONB (built to absorb new keys without schema
  churn).
- **Every finance-shaped answer carries `sources`** (AGENTS §6). Rarity,
  evolutions, and pulses are computed from cited provider data; if it can't
  be cited it returns `confidence: "low"`, not a guess.
- **Cost control**: graph generation is at-most-once per ticker per filing
  cycle (global cache, not per-user); briefs cache 24h; notification scoring
  runs on data already fetched by the scheduler. Nothing in Workstream A or B
  adds a per-user LLM call on a hot path.
- **Notification budget is product law**: threshold-gated, deduped, capped
  (B4). Fatigue kills this category faster than any missing feature.
- **Compliance framing**: evolutions, pulses, and rivalries are collection
  and comprehension mechanics. Copy never instructs a trade.
- **Not building now**: social graph, leaderboards, PvP, hourly-regardless
  pushes, a first-party EDGAR client, PostGIS.

## 5. Sequencing

Order of ship, with the dependency that forces it:

| # | Slice | Depends on |
|---|-------|-----------|
| 1 | B1 foreground brief fix | nothing (bug fix) |
| 2 | A1 progression store + streak | nothing |
| 3 | A2 evolution notifier | A1 (XP write) |
| 4 | A3 counterfactual portfolio | nothing |
| 5 | A4 dex + rarity | A1 |
| 6 | B2 silhouette pins | nothing |
| 7 | C1 graph store + extraction | nothing |
| 8 | C2 orbit + constellations | C1, B2 (visual language) |
| 9 | A5 quests | A1, A4; edge quests need C1 |
| 10 | B3 widget heartbeat | nothing |
| 11 | B4 arrival push | B3, A4 (scoring uses dex) |
| 12 | A6 territory / A7 events | A1 |
| 13 | C3 demand pulse | C1 + Massive fundamentals wiring |
| 14 | C4 environment layer | FRED provider |
| 15 | C5 synthesis memo | C1, C3, C4 |
| 16 | C6 rivalries | A1, comparables (exists) |
| 17 | B5 Always-permission visits | B4 proven |

Slices 1–8 need zero new permissions, zero new external providers, and no
background machinery — each moves retention on its own.

## 6. Wave-2 follow-ups (known, deliberate deferrals)

- [x] Quest/territory baselines read `listFinds(·, 200)` — a user with >200
      finds gets a truncated "before today" baseline, so `new_tile` /
      `new_sector` can re-complete for tiles/sectors visited long ago. Fix:
      dedicated `SELECT DISTINCT geohash6` / distinct-effective-ticker store
      queries feeding `completionFor` and the territory numerator.
- [x] Pre-`geohash6`-migration finds never claimed a `pioneer:` grant, so the
      first post-migration find in an already-visited tile still collects the
      bonus once. One-time backfill of `geohash6` (and optionally the grant
      ledger) closes it.
- [x] iOS lockstep: `src/api/graph.ts` declares CompanyEdge/DemandPulse as
      plain TS types; move them (and the unconsumed Territory/Events/Rivalry/
      Environment/Synthesis shapes when the UI consumes them) into
      `src/api/types.ts` as zod mirrors per that file's convention.
- [x] Layering: `demand-pulse.ts` / `environment-brief-generator.ts` pure math
      could move into `packages/finance` (docstrings currently state the real
      location; `local-brief-generator.ts` is the in-apps/api precedent).
