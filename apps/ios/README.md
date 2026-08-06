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
- `/(tabs)/camera` — full-frame capture → `POST /v1/identify`. Result card
  taps through to the detail sheet.
- `/(tabs)/list` — sortable by distance, publicness, or sector; live quotes + sector accent dots.
- `/(tabs)/research` — ChatGPT-like research threads (Derivation idea-chats → article briefs).
- `/(tabs)/saved` — watchlist + cockpit/alerts; ★ Save / memos from detail.
- `/(tabs)/admin` — hidden unless the signed-in user has `admin` scope.
- `/detail/[id]` — Overview (auction chart, Research…, Save, memo) + Advanced charts/SEC.

## Offline photo queue

`src/queue/photoQueue.ts` persists pending captures to AsyncStorage and
`useNetworkSync` drains the queue whenever `@react-native-community/netinfo`
reports the device is back online. The camera screen shows the queued count.

## Build (EAS)

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
