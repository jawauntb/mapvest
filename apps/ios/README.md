# @mapvest/ios

Expo React Native iOS app (TypeScript, expo-router, SDK 52+).
TestFlight-buildable via EAS.

## Quickstart

> **iOS is NOT part of the Bun workspace.** Expo's Metro resolver breaks
> against Bun's hoisted `.bun/` symlink layout, so this app is installed
> and run from its own `apps/ios/node_modules`. Use `npm` here, not `bun`.

```
brew install watchman            # Metro's file watcher (one-time)
cd apps/ios
npm install --no-workspaces      # -- writes apps/ios/node_modules
EXPO_PUBLIC_API_URL=https://api-production-4b27.up.railway.app npx expo start --ios
```

By default (when `EXPO_PUBLIC_API_URL` is unset) the app talks to
`http://localhost:3001` — the local `apps/api` service. In dev you almost
always want the deployed API instead, as shown above.

The EAS `preview` and `production` profiles pin their own `EXPO_PUBLIC_API_URL`
in `eas.json`.

## Screens

- `/auth` — passwordless magic-link email sign-in.
- `/(tabs)/map` — `react-native-maps` w/ Google provider. Pins colored by
  publicness (green = public ticker, orange = has comps/ETFs, red/gray = other).
- `/(tabs)/camera` — full-frame capture → `POST /v1/identify`. The primary
  match has an explicit detail CTA; every additional match stays available in
  the card. A zero-match response offers Refine and Retake recovery actions.
  After a signed-in public result with a real captured quote, a one-time
  per-user/device Find evolution offer may appear; only its direct CTA can
  ask iOS for permission and it enables that device's all-finds event plus
  master delivery. It never implies that just the triggering brand is tracked.
  The result/cache is scoped to the identity that started identify and is
  cleared on account changes; the bounded, single-scroll result card keeps
  evidence and every action reachable on compact iPhones.
- Push preferences are read and written only with this install's stored
  push-token id. A missing or stale id never falls back to another account
  device, and iOS enrollment requires alert presentation to be enabled.
- `/(tabs)/list` — sortable by distance, publicness, or sector; live quotes + sector accent dots.
- `/(tabs)/research` — ChatGPT-like durable research conversations (Derivation unified agent → article briefs).
- `/watchlists` — watchlist + cockpit/alerts; ★ Save / memos from detail.
- `/(tabs)/admin` — hidden unless the signed-in user has `admin` scope.
- `/detail/[id]` — Investable is a stack **card** (not a page-sheet modal).
  One Charts section at the top: a single chip row switches between Price
  and Underlying Analyzer chart types (`src/components/ChartsSection.tsx`),
  rendered with View primitives (`src/chartkit/`, no `react-native-svg`) from JSON data
  endpoints. Nested Research / news-reader sheets mount only when opened.
  Client + types live in `src/api/underlying.ts`; base URL overridable via
  `EXPO_PUBLIC_UNDERLYING_API_URL`. Below it: Research, Save/memo, comps,
  ETFs, SEC, news, agent brief.
- `/prism/[ticker]` — **Prism**, the full-stack memo dashboard (working name
  "ubermemo"). See the Prism section below.

Home and Your universe refresh their signed-in finds, progression, summary,
dex, and quests data only after that session successfully identifies at least
one investable in Camera. The first refresh runs on focus and one cancellable
follow-up covers the short window in which the identify endpoint records a find
after its response has returned; blurring preserves that pending work for the
next eligible focus. Find observers use limit-aware cache keys (100 rows for
Home/Map and 200 for Your universe/Orbit), while focus invalidation uses the
shared `finds/{token}` prefix to update both projections.

## Prism (`/prism/[ticker]`)

Prism splits one ticker's price into macro, factor, regime, spectral, entropy,
fundamental, and filing components and recombines them into bull / neutral /
bear scenarios, a recommendation, entry and exit levels, and a chat-able memo.
The engine lives in the sibling `underlying-analyzer-reboot` service; the app
talks only to the Mapvest proxy at `/v1/prism/*` (alias `/v1/ubermemo/*`).

**Entry point.** One button: "Prism" in the actions row of `/detail/[id]`, next
to Memo — in both the signed-in and the signed-out branch, because
`/v1/prism` is `optionalAuth` and meters anonymous callers by `X-Device-Id`
exactly like the memo button beside it. It routes to `/prism/{ticker}`; the
packet is built on demand there.

**Files.**

- `src/api/prism.ts` — typed client and the packet contract as TypeScript
  (`PrismPacket` and every section), mirroring the zod schemas in
  `packages/core`. Also `formatPrismError`, which keeps upstream transport
  detail off the screen.
- `src/prism/constants.ts` — the vocabulary (horizons, windows, cases). Zero
  imports, so the pure helpers and their tests never pull in the fetch stack.
- `src/prism/format.ts`, `scenario.ts`, `signals.ts`, `progress.ts` — pure
  helpers: formatting, the scenario mixture math, packet → chart rows, and the
  staged build copy. Unit tested with `bun test apps/ios/src/prism`.
- `src/prism/usePrismPacket.ts` / `usePrismChat.ts` — packet lifecycle and the
  chat thread.
- `src/prism/*Section.tsx`, `PrismHero.tsx`, `PrismProgress.tsx`, `ui.tsx` —
  the screen.
- `src/chartkit/prism/*` — the charts (regime ribbon, seasonality grid, horizon
  fan, correlation/beta heatmap with kinematics arrows, spectral cycle wheel and
  wave, entropy gauge and backtest bars, factor bars, sparklines, yield curve,
  volatility smile, key-level ladder, scenario density). They are drawn with the
  same View-backed SVG shims as the rest of `src/chartkit` (no
  `react-native-svg`) but painted with Atlas Signal tokens, not the amber
  terminal palette — that palette is the analyzer charts' data contract and
  stays with them.

**Three behaviours worth knowing.**

1. *The build is slow.* `POST /v1/prism` runs the whole engine and takes one to
   three minutes. `usePrismPacket` shows staged, elapsed-time progress copy and
   at the same time polls `GET /v1/prism/:ticker` every five seconds, so a
   dropped request still ends with the packet on screen. A 404 from the read
   route is the "never built" state, not an error.
2. *A null section is still a rendered section.* Every card mounts whether or
   not the engine produced its data; when it did not, the card says
   "unavailable" and names the reason from the packet's own `<section>_error`
   sibling or `meta.errors`. Nothing renders a null as zero, and the last card
   on the page is the provenance ledger listing every source that failed.
3. *Sections mount lazily.* The page carries a dozen charts. `LazySection`
   mounts each one a viewport ahead of the reader and never unmounts it.

**Honesty rules the screen enforces.** These are places where the packet says
something more careful than the obvious reading, and the UI has to say the
careful thing:

- *Exit targets are not odds.* `memo.exit_targets[].probability` is the **bull
  case's** probability at that horizon — the engine copies it off the same bull
  block it took `price_p50` from and says so in `basis`. The hero labels it
  "12M · bull case 27%" and prints the basis underneath. Calling it "27% odds"
  would overstate the chance of the price by roughly 2×.
- *Weights are not always earned.* `ScenariosSection` reads
  `scenarios.weight_evidence`. When the engine reports a `fallback`, the
  subtitle says the weights are a shrunk prior, and every component listed in
  `prior_only_components` is marked "· prior" next to its bar.
- *Prices carry their date.* The hero prints `scenarios.entry.current_price`
  and nothing else — never `memo.entry_price`, which is a bargain threshold —
  captions it `close · {as_of}`, and shows an amber "rebuild for current prices"
  line once the packet is more than three days old (`isPacketStale`).
- *A build costs a generation and says so.* Both "Build packet" and "Rebuild"
  carry the cost in their label and accessibility label and confirm before
  spending; the three exports beside them are free.

Research only — the screen states "not investment advice" and Prism never
places orders.

## Offline photo queue

`src/queue/photoQueue.ts` persists pending captures to AsyncStorage and
`useNetworkSync` drains the queue whenever `@react-native-community/netinfo`
reports the device is back online. Every new item is stamped with a non-secret
ownership scope: `guest` or the stable authenticated user ID. The bearer token
is used only for the live upload and is never written to AsyncStorage. The
camera only counts and uploads items for its current scope, so a guest or one
account can never drain another account's captures.

The old v1 unscoped queue migrates to a protected `legacy-unscoped` state.
Those photos fail closed: they are never attributed to, or uploaded by, a
signed-in account. Camera truthfully shows their count and asks the person to
retake the photo to requeue it under the current scope. Storage mutations are
serialized so simultaneous enqueue, flush, and removal cannot overwrite jobs;
an account switch aborts the stale flush and leaves its remaining jobs for the
matching account's next session.

New queue entries first copy their image to Mapvest's private
`documentDirectory/mapvest-photo-queue/` folder. The queue persists only that
managed URI and removes it after a confirmed upload or an explicit discard; it
never deletes the original Camera or library URI. Corrupt, truncated,
malformed, or unknown-version payloads are **not** treated as an empty queue:
their exact raw value is retained under a private quarantine key, uploads and
new captures stop, and Camera provides an accessible, informed discard action.
That action clears only the active queue; the quarantine copy remains for local
diagnostics.

**Known follow-up (P2):** `/v1/identify` has no client idempotency key. If the
server accepts an upload but the app crashes or AsyncStorage fails before its
queue record can be removed, a later retry can submit it again. The client
avoids retrying after a successful local removal, but a durable end-to-end
guarantee needs server-supported identify idempotency.

## Build (EAS)

Production TestFlight is explicit: after green `ci` on `main`, dispatch the
protected manifest-bound `ios-eas-production` workflow (see
`DEPLOY_TESTFLIGHT.md`). Local builds remain available for development:

```
bun run build:dev     # dev client, simulator
bun run build:preview # internal distribution, staging API
bun run build:prod    # store build, prod API
bun run submit        # eas submit --platform ios --latest
```

Bundle id `com.mapvest.app`. Google Maps API keys are injected via EAS env
(`IOS_GOOGLE_MAPS_API_KEY`, `ANDROID_GOOGLE_MAPS_API_KEY`) — do **not**
hardcode them. See `docs/SECRETS.md`.

## Types

`src/api/types.ts` is a lockstep re-declaration of
`packages/core/src/schemas/index.ts`. RN Metro cross-package resolution is
finicky for v0, so we copy the shape verbatim. If you touch either file,
touch both.
