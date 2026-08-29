# TestFlight submission — one-shot guide

Everything is pre-configured. The three commands below run against the current
`eas.json`, `app.json`, and the deployed API at
`https://api-production-4b27.up.railway.app`.

## CI (required for TestFlight)

Repo secret `EXPO_TOKEN` (Expo access token; never commit it). `eas.json`
uses `cli.appVersionSource: remote` plus `production.autoIncrement`, so EAS
owns `buildNumber` and every merge gets a unique value. Do not bump
`app.json` by hand for TestFlight.

Merges to `main` that pass `ci` cut a production TestFlight automatically
(`.github/workflows/ios-eas-production.yml`, `workflow_run` after `ci`).
Retry or cut from a tag without waiting for a merge:

```
gh workflow run ios-eas-production.yml --ref main
git tag v0.1.0 && git push origin v0.1.0
```

Do not set `EAS_NO_VCS=1`. The EAS worker keeps the git root as
`/Users/expo/workingdir/build` and looks for `apps/ios/package.json`. A
VCS-less archive from `apps/ios` (or a worktree pack that drops that nested
path) fails in `PRE_INSTALL_HOOK` before native compilation.

The workflow installs `apps/ios` with `npm install --no-workspaces` (iOS is not a Bun workspace; the committed lockfile can lag `package.json`), validates the external-distribution workflow after authenticated EAS setup, then waits on `eas build --auto-submit`. An invalid distribution workflow, failed hook, or compile fails the Actions check.

When App Store Connect finishes receiving that exact upload, the EAS workflow
at `.eas/workflows/testflight-external.yml` assigns its Apple build ID to the
external `friend-testers` group and submits it for Beta App Review. The Expo
project must remain connected to App Store Connect app `6798832989`; verify the
link without changing it with:

```
(
  cd apps/ios
  eas integrations:asc:status --json
  eas workflow:validate .eas/workflows/testflight-external.yml --non-interactive
)
```

The event trigger is build-specific—never replace it with a generic "latest"
lookup. If an event run needs repair, copy the Apple build ID from the EAS
workflow or App Store Connect and run the same job explicitly:

```
(
  cd apps/ios
  eas workflow:run .eas/workflows/testflight-external.yml \
    --input asc_build_id=APPLE_BUILD_ID \
    --non-interactive \
    --wait
)
```

External distribution cannot bypass Apple processing or Beta App Review.
Approved builds become available to the whole `friend-testers` group; each
tester controls whether TestFlight installs them automatically on their phone.

Every production release first runs a local macOS EAS build with the
`production-preflight` profile. It downloads the same managed certificate and
profiles and performs the release Xcode signing pass, but `autoIncrement` is
off and no EAS cloud build is reserved. The cloud build and TestFlight
submission start only after this preflight is green, including when signing
credentials drift outside git. The production EAS image is pinned to
`macos-sequoia-15.6-xcode-26.0`; GitHub explicitly selects its available Xcode
26.0 generation instead of a moving default. Local EAS does not clone every
cloud-image tool—the gate proves that the current source and production
credentials can complete a signed archive before spending a cloud build.

If an entitlement or capability changes, declare it in `ios.entitlements` so
EAS can sync it before Expo prebuild, then regenerate the existing App Store
provisioning profile. Run `eas credentials -p ios`, choose `production`, log
into Apple, then use **Build Credentials** to delete only the affected target's
profile. Choose **All**, reuse the distribution certificate, and generate the
replacement profile. `--clear-cache` cannot repair a signing profile, and
unrelated extension profiles should be left intact.

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

- Internal groups receive eligible builds through App Store Connect's automatic
  internal distribution.
- The populated external group is `friend-testers`; its public link is
  `https://testflight.apple.com/join/yvYrrxbM`.
- `.eas/workflows/testflight-external.yml` adds every completed upload to that
  exact external group, supplies "What to Test", and requests Beta App Review.
- Keep the app-level TestFlight description, feedback/contact details, export
  compliance, and review login information complete so Apple can accept the
  automated review request.

## 4. Public link

The live `friend-testers` public URL is
`https://testflight.apple.com/join/yvYrrxbM`; the landing page already uses it.

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
