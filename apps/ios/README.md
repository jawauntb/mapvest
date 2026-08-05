# @mapvest/ios

Expo React Native iOS app. TestFlight-buildable via EAS.

## Run local

```
bun install
bun run ios     # requires Xcode + iOS Simulator
```

## Build

```
eas build --platform ios --profile production
eas submit --platform ios --latest
```

See `../../docs/DEPLOY.md`.
