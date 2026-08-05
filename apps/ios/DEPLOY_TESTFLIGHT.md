# TestFlight submission — one-shot guide

Everything is pre-configured. The three commands below run against the current
`eas.json`, `app.json`, and the deployed API at
`https://api-production-4b27.up.railway.app`.

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
- Camera tab: photograph any storefront (McDonald's, Starbucks, CVS, etc.)
- Live-scan tab: point the phone at aisle products at 1 frame/sec
- Map tab: pins around your location, colored by publicness
- List tab: sort by distance, market cap, or sector

Feedback → jawaun@generalintelligencecompany.com
```

## Rollback

If a build is broken, expire it in TestFlight (App Store Connect → Builds →
edit → Expire) and re-submit an older build from `eas build:list` via
`eas submit --id <build-id>`.
