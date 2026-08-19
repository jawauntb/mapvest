# TestFlight submission — one-shot guide

Everything is pre-configured. The three commands below run against the current
`eas.json`, `app.json`, and the deployed API at
`https://api-production-4b27.up.railway.app`.

## CI (preferred)

Repo secret `EXPO_TOKEN` (Expo access token; never commit it). Then:

```
gh workflow run ios-eas-production.yml --ref main
```

The workflow installs `apps/ios` with `npm install --no-workspaces` (iOS is not a Bun workspace; the committed lockfile can lag `package.json`), then `eas build --auto-submit --no-wait`. Watch the EAS build past `PRE_INSTALL_HOOK` — Actions only queues it.

## 0. One-time prerequisites

1. **Apple Developer account** (paid $99/yr). Team ID is what EAS asks for on
   first submit.
2. **EAS login**:

   ```
   cd apps/ios
   eas login          # opens browser once, stores creds in ~/.expo/state.json
   eas whoami         # confirm
   ```

3. **EAS project init** (only if the project isn't already linked):

   ```
   eas project:init   # picks up expo.slug=mapvest and expo.ios.bundleIdentifier=com.mapvest.app
   ```

## 1. Build

```
cd apps/ios
bun install                                   # once
eas build --platform ios --profile production
```

EAS will ask for the Apple credentials on the first run — pick "Let EAS manage
credentials" so it stores the cert + provisioning profile in EAS. Build takes
~15 min on EAS's Metal builder.

## 2. Submit

Once the build shows in `eas build:list`:

```
eas submit --platform ios --latest
```

This uploads to App Store Connect and pushes to TestFlight processing (~10 min
after Apple finishes their processing scan).

## 3. Configure TestFlight

Open App Store Connect → your app → TestFlight:

- **Internal Testing Group**: create `mapvest-demo`, add teammates by their
  Apple ID email. They get an invite + can install via the TestFlight app.
- **What to Test**: paste the release notes below.
- Optionally add an **External Testing Group** for public link distribution
  (requires a Beta App Review; ~24-48h turnaround).

## 4. Public link

Once a build passes review (external group only), TestFlight gives you a
`https://testflight.apple.com/join/XXXXXXXX` URL. Paste that into the landing
page's TestFlight CTA by editing `apps/landing/src/app/page.tsx` and searching
for `testflight.apple.com/join/PLACEHOLDER`.

## Release notes (paste into TestFlight "What to Test")

```
Mapvest v0.1.0

Point your phone at a storefront or product and Mapvest identifies the brand
and its investable ticker. Private goods get matched to public comparables +
ETFs with meaningful exposure.

Try:
- Camera: snap anything with a name on it — instant identify, no circle step.
  The card shows what it means ("you can own this" / "closest public cousin"),
  price, confidence, and source chips. Refine lets you circle + hint.
- Home: "Your universe" shows your recent finds and streak; watchlist counts
  read "companies"; camera-found tickers show a camera mark.
- Map: pins carry tickers; unresolved rows say "Tap to look up"; zoom
  refreshes.
- Local Economy Brief: names your neighborhood; footer says "sources cited ·
  research, not advice."
- Research: briefs show source chips; threads name themselves after the
  ticker.
- Notifications (if opted in): morning read, movers ("it's in your universe"),
  found-it pushes.

Feedback → jawaun@generalintelligencecompany.com
```

## Rollback

If a build is broken, expire it in TestFlight (App Store Connect → Builds →
edit → Expire) and re-submit an older build from `eas build:list` via
`eas submit --id <build-id>`.
