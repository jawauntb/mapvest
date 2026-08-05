# @mapvest/ios

Expo React Native iOS app (TypeScript, expo-router, SDK 52+).
TestFlight-buildable via EAS.

## Quickstart

```
bun install
bun run ios     # requires Xcode + iOS Simulator
```

By default the app talks to `http://localhost:3001` (the local `apps/api`
service). Override at runtime with `EXPO_PUBLIC_API_URL`:

```
EXPO_PUBLIC_API_URL=https://mapvest-api.up.railway.app bun run ios
```

The EAS `preview` and `production` profiles pin their own `EXPO_PUBLIC_API_URL`
in `eas.json`.

## Screens

- `/auth` — passwordless magic-link email sign-in.
- `/(tabs)/map` — `react-native-maps` w/ Google provider. Pins colored by
  publicness (green = public ticker, orange = has comps/ETFs, red/gray = other).
- `/(tabs)/camera` — full-frame capture → `POST /v1/identify`. Result card
  taps through to the detail sheet.
- `/(tabs)/live-scan` — throttled ~1 fps frame capture piped through
  `/v1/identify`, with an in-flight guard so slow responses cannot backlog.
- `/(tabs)/list` — sortable by distance, publicness, or sector.
- `/(tabs)/admin` — hidden unless the signed-in user has `admin` scope.
- `/detail/[id]` — modal sheet with ticker, comparables, ETF exposure, sources.

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
