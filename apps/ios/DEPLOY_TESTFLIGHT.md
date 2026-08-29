# TestFlight submission — one-shot guide

Everything is pre-configured. The commands below run against the current
`eas.json`, `app.json`, and the deployed API at
`https://api-production-4b27.up.railway.app`.

## CI (required for TestFlight)

Repo secret `EXPO_TOKEN` (Expo access token; never commit it). `eas.json`
uses `cli.appVersionSource: remote` plus `production.autoIncrement`, so EAS
owns `buildNumber` and every production build gets a unique value. Do not bump
`app.json` by hand for TestFlight.

Merges to `main` that pass `ci` cut a production TestFlight automatically
(`.github/workflows/ios-eas-production.yml`, `workflow_run` after `ci`).
Manually cut from `main` or a tag without waiting for another merge:

```
gh workflow run ios-eas-production.yml --ref main
git tag v0.1.0 && git push origin v0.1.0
```

`gh workflow run` returns as soon as GitHub accepts the dispatch. The GitHub
Action itself waits for signing, build, upload, group assignment, and review
submission. Follow the exact Actions run in the repository UI, or list the
recent runs and then watch the selected run ID:

```
gh run list --workflow ios-eas-production.yml --event workflow_dispatch --limit 5
gh run watch GITHUB_RUN_ID --exit-status
```

Do not set `EAS_NO_VCS=1`. The EAS worker keeps the git root as
`/Users/expo/workingdir/build` and looks for `apps/ios/package.json`. A
VCS-less archive from `apps/ios` (or a worktree pack that drops that nested
path) fails in `PRE_INSTALL_HOOK` before native compilation.

The workflow installs `apps/ios` immutably with `npm ci --no-workspaces` and
validates both TestFlight workflows after authenticated EAS setup. The
production runner rejects committed-source drift and queries one
server-filtered snapshot of prior production EAS runs. Only `SUCCESS`,
`FAILURE`, and `CANCELED` are terminal EAS states; any other or unknown state
blocks dispatch. It keeps that pre-dispatch snapshot until EAS returns: if the
response is lost, the runner polls briefly and adopts only the single run that
was not in the snapshot. It uploads the exact checked-out source, atomically
persists the returned EAS run ID before waiting, and writes its ID and URL to
the GitHub step summary. Ambiguous polling cancels and reconciles that exact
ID. Every ordinary release step is cancellation-sensitive; the enclosing job
stays available only so its signal handler can preserve any recoverable ID and
a separate `cancelled()` step can get up to four minutes to
cancel and confirm the persisted run. If hard termination or the network
prevents confirmation, every later production run refuses to overlap the
orphan.

The production EAS workflow has two linked jobs. `build_ios` builds the
uploaded source with the `production` profile; `distribute_to_testflight`
consumes that build job's EAS build UUID directly, allows up to 60 minutes for
App Store Connect processing, assigns the exact build to external
`friend-testers`, and submits it for Beta App Review. The Expo project must
remain connected to App Store Connect app `6798832989`; verify the link and
both workflow schemas without changing them with:

```
(
  cd apps/ios
  eas integrations:asc:status --json
  eas workflow:validate .eas/workflows/testflight-production.yml --non-interactive
  eas workflow:validate .eas/workflows/testflight-external.yml --non-interactive
)
```

GitHub Actions is the routine release entry point. Its `queue: max` concurrency
serializes up to 100 pending requests. A cheap release gate compares every
completed-CI SHA with the current `main` SHA and skips stale out-of-order CI
completions before signing. The same comparison runs again immediately before
EAS dispatch, so a commit that becomes stale during the signing preflight is
also skipped; explicit tag and manual refs remain intentional releases. GitHub
cancels requests beyond that 100-run bound. Running the
production runner directly bypasses the GitHub queue and signing preflight, so
use it only as break-glass recovery from a clean intended checkout. The
following guard exits nonzero if GitHub already has any nonterminal production
release; the runner then performs the same executable EAS orphan
guard before dispatch:

```
(
  set -euo pipefail
  active_count="$(gh run list \
    --workflow ios-eas-production.yml \
    --limit 100 \
    --json status \
    --jq '[.[] | select(.status != "completed")] | length')"
  test "$active_count" -eq 0
  cd apps/ios
  bun scripts/testflight-production.ts
)
```

Outside GitHub Actions, that runner invokes the pinned `eas-cli@22.0.0` through
`npx`; the GitHub Action uses the same version installed by its EAS setup step.
Its EAS guard is a snapshot rather than an atomic cross-operator lock: never
start two direct runners concurrently or dispatch the production workflow from
the Expo dashboard while GitHub is releasing.

For a partial distribution failure after an upload is already processed and
ready in App Store Connect, rerun only the ASC recovery workflow. Its review
input defaults to `true`. `PROCESSED_ASC_BUILD_ID` is the App Store Connect
build resource ID—not the visible build number or EAS build ID. Resolve it
from the failed EAS TestFlight job when present or through the App Store
Connect API:

```
(
  cd apps/ios
  eas workflow:run .eas/workflows/testflight-external.yml \
    --input asc_build_id=PROCESSED_ASC_BUILD_ID \
    --non-interactive \
    --wait
)
```

External distribution cannot bypass Apple processing or Beta App Review. A
successful routine production workflow means the build was assigned to
`friend-testers` and the review request was submitted; it does not mean Apple
approved the build or that TestFlight installed it on a tester's phone. Each
tester controls the Automatic Updates setting on their device.

Apple accepts only one build of each marketing version into Beta App Review at
a time and no more than six TestFlight review submissions in 24 hours. GitHub
serializes release jobs, but its lock ends when Apple accepts the review
request—not when Apple finishes reviewing it. If a later same-version release
fails because another build is still in review, do not rebuild it: wait for
the active review to finish, choose the newest processed pending build, and run
the ASC recovery workflow above with `submit_beta_review=true`. Superseded
pending builds do not need to be submitted just to make the newest build
available.

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

## 1. Build + distribute

```
gh workflow run ios-eas-production.yml --ref main
```

GitHub runs the signing preflight, uploads the checked-out source, builds it
with the production profile, and passes that build's UUID to the external
TestFlight job. The dispatch command returns immediately; use the Actions page
or `gh run watch GITHUB_RUN_ID --exit-status` to wait. Use the direct runner
above only for break-glass recovery after its guards pass.

## 2. Confirm

After the GitHub Action completes, confirm the resulting build and workflow run:

```
eas build:list --platform ios --limit 1
eas workflow:runs
```

The release still remains subject to App Store Connect processing and, for the
external group, Beta App Review.

## 3. Configure TestFlight

Open App Store Connect → your app → TestFlight:

- Internal groups receive eligible builds through App Store Connect's automatic
  internal distribution.
- The populated external group is `friend-testers`; its public link is
  `https://testflight.apple.com/join/yvYrrxbM`.
- `.eas/workflows/testflight-production.yml` passes each production build
  job's UUID to that exact external group, supplies "What to Test", and
  requests Beta App Review.
- `.eas/workflows/testflight-external.yml` is manual recovery for one processed
  App Store Connect build ID; it never selects a generic latest build.
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
edit → Expire). To restore a still-valid, previously approved build, use its
exact App Store Connect build ID with the recovery workflow and disable a new
review request:

```
(
  cd apps/ios
  eas workflow:run .eas/workflows/testflight-external.yml \
    --input asc_build_id=VALID_PRIOR_ASC_BUILD_ID \
    --input submit_beta_review=false \
    --non-interactive \
    --wait
)
```

The prior build must still be processed, unexpired, valid for testing, and
already approved. If no such build exists, cut a new production release; do
not use a generic latest-build lookup or re-upload an arbitrary old EAS build.
