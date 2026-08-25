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

Home and Your universe refresh their signed-in finds, progression, summary,
dex, and quests data only after that session successfully identifies at least
one investable in Camera. The first refresh runs on focus and one cancellable
follow-up covers the short window in which the identify endpoint records a find
after its response has returned; blurring preserves that pending work for the
next eligible focus. Find observers use limit-aware cache keys (100 rows for
Home/Map and 200 for Your universe/Orbit), while focus invalidation uses the
shared `finds/{token}` prefix to update both projections.

## Offline photo queue

`src/queue/photoQueue.ts` persists pending captures to AsyncStorage and
`useNetworkSync` drains the queue whenever `@react-native-community/netinfo`
reports the device is back online. The camera screen shows the queued count.

## Build (EAS)

Production TestFlight is automatic: green `ci` on `main` runs
`ios-eas-production` (see `DEPLOY_TESTFLIGHT.md`). Manual:

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
