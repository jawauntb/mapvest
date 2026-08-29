# Deploy

Two production surfaces:

1. **Railway** — API + landing page + Postgres.
2. **TestFlight** — iOS app.

## Railway

### First-time project setup

```bash
railway login
railway init                # create a new project 'mapvest'
railway link                # link this repo to it
```

### Services

Create two Railway services from this repo:

- `api` — root: `apps/api`, start command: `bun run start`, healthcheck: `/v1/health`
- `landing` — root: `apps/landing`, start command: `bun run start`
- (Plugin) Postgres

### Variables

Shared Massive credentials are authoritative in Doppler `shared/prd` (personal
workplace) and should reach Railway through the Doppler integration, never
copied into Railway variables. Service-specific Mapvest values may remain in
their own service project. See `infra/doppler/README.md` for the separation.

### Deploy

- Auto-deploy on push to `main` via GitHub integration.
- Manual: `railway up --service api`.

### Research verification

After the API deployment is healthy, open or refresh a pre-existing saved
research thread from an internal account. The thread should load without a
research service unavailable message; this read-only check does not admit a new
generation or spend quota.

If it fails, compare the deployed `DERIVATION_RESEARCH_API_ORIGIN` with the
Console's current canonical origin. `RESEARCH_CONSOLE_FORWARDED_HOST` must be
unset for direct Railway-to-Railway traffic and set only when a real trusted
proxy is in the path. Do not rotate, print, or paste service tokens while
diagnosing host configuration.

### Domains

- Landing: `https://mapvest.app` — public site. `www.mapvest.app` is the Railway custom domain on the `landing` service (port 3000). The apex `301`s to `www` at GoDaddy.
- API: `https://api-production-4b27.up.railway.app` — Railway service domain. No custom API host yet.

The previous landing URL `https://landing-production-ce7b.up.railway.app` still resolves and can stay as a fallback.

## TestFlight (iOS)

### Prerequisites

- Apple Developer account (paid) — team ID recorded in `apps/ios/eas.json`.
- Xcode 26.0 for production-equivalent local builds. `xcodebuild -version`
  must succeed.
- EAS CLI: `bun add -g eas-cli` (or `bunx eas ...`).

### First-time

```bash
cd apps/ios
eas login
eas init                   # creates the EAS project
eas credentials            # let EAS manage signing
```

Bundle id: `com.mapvest.app` (change if the Apple team requires).

### Build + submit

```bash
# Preview / internal
eas build --platform ios --profile preview

# Routine production TestFlight release (uses the GitHub queue + preflight)
gh workflow run ios-eas-production.yml --ref main
```

The CLI command only dispatches the GitHub workflow. Select its exact ID from
`gh run list --workflow ios-eas-production.yml --event workflow_dispatch` and
wait with `gh run watch GITHUB_RUN_ID --exit-status`, or follow it in Actions.

Directly starting the production EAS workflow bypasses the GitHub signing
preflight and serialized queue. Use the guarded runner only as break-glass
recovery from a clean intended checkout after proving GitHub has no release:

```bash
(
  set -euo pipefail
  active_count="$(gh run list --workflow ios-eas-production.yml --limit 100 --json status --jq '[.[] | select(.status != "completed")] | length')"
  test "$active_count" -eq 0
  cd apps/ios
  bun scripts/testflight-production.ts
)
```

The direct runner resolves pinned `eas-cli@22.0.0` through `npx`; GitHub uses
the same CLI version installed by its authenticated EAS setup step.
Its EAS guard is a snapshot rather than an atomic cross-operator lock: never
start two direct runners concurrently or dispatch the production workflow from
the Expo dashboard while GitHub is releasing.

### CI (automatic)

GitHub Action `ios-eas-production` (`.github/workflows/ios-eas-production.yml`) cuts a production TestFlight after **green `ci` on `main`**, the same `workflow_run` gate as Railway `deploy.yml`. Its `queue: max` concurrency serializes up to 100 pending requests; GitHub cancels requests beyond that bound. A cheap gate compares each completed-CI SHA with the current `main` SHA and skips stale out-of-order CI completions before signing. The comparison runs again immediately before EAS dispatch, so a SHA that becomes stale during signing is also skipped. Explicit manual and tag refs remain intentional releases. The job installs iOS dependencies with immutable `npm ci --no-workspaces`, validates both TestFlight workflows, and starts `apps/ios/scripts/testflight-production.ts`.

The runner proves the checkout is clean and queries one server-filtered
snapshot of prior production EAS runs. It treats only `SUCCESS`, `FAILURE`, and
`CANCELED` as terminal EAS states, so any active or unknown state blocks a new
dispatch. If EAS accepts a dispatch but loses the response, the runner polls
briefly and adopts only the single run absent from that snapshot. It atomically
persists the returned exact EAS run ID, adds its ID and URL to the GitHub step
summary, and waits on that ID. Ambiguous status failures cancel and reconcile
the exact run. Every ordinary release step is cancellation-sensitive; the
enclosing job stays available only so the signal handler can preserve any
recoverable ID and a separate `cancelled()` cleanup step can use that ID for up
to four minutes. If hard termination or the network
prevents confirmation, the next pre-dispatch guard still refuses to overlap
the orphan.

The production EAS workflow builds the checked-out source with `build_ios`,
passes that job's EAS build UUID directly to `distribute_to_testflight`, waits
up to 60 minutes for App Store Connect processing, adds the exact build to
external `friend-testers`, and submits it for Beta App Review. An ordinary
terminal EAS failure remains a failure and is not followed by another
cancellation. An invalid workflow, `PRE_INSTALL_HOOK`, compile, upload,
processing timeout, or distribution failure makes the GitHub check red.

Every production release first runs the `production-preflight` profile as a
local macOS EAS build. It uses the same EAS-managed production certificate and
provisioning profiles but has `autoIncrement: false`, so a signing mismatch
fails before EAS reserves another cloud build number. This is unconditional:
it also catches profiles changed, revoked, or expired outside the repository.
The cloud profile pins Expo's `macos-sequoia-15.6-xcode-26.0` image, while the
GitHub preflight explicitly selects the available Xcode 26.0 generation rather
than its moving default. Local EAS does not reproduce every cloud-image tool;
its required invariant here is a complete archive using the production
credentials before the cloud build can start.

Also:

- **Manual:** Actions → `ios-eas-production` → Run workflow (on `main`)
- **Tag:** `git tag v0.1.0 && git push origin v0.1.0`

Requires repo secret `EXPO_TOKEN` (Expo access token). Apple signing + ASC submit stay in EAS-managed credentials. Do not set `EAS_NO_VCS=1`. `eas.json` uses `cli.appVersionSource: remote` so every production build gets a unique `buildNumber` without a sync commit.

### App Store Connect recovery

If the build is already processed and ready in App Store Connect but group or
review submission failed, run the ASC-only recovery workflow with its exact
build ID. `submit_beta_review` defaults to `true` for normal partial-failure
repair:

```bash
cd apps/ios
eas workflow:run .eas/workflows/testflight-external.yml \
  --input asc_build_id=PROCESSED_ASC_BUILD_ID \
  --non-interactive \
  --wait
```

This workflow does not build, upload, wait for ASC processing, or select a
generic latest build. `PROCESSED_ASC_BUILD_ID` is the App Store Connect build
resource ID, not the visible build number or EAS build ID; resolve it from the
failed EAS TestFlight job when present or through the App Store Connect API.

Apple allows only one build of each marketing version in Beta App Review at a
time and up to six TestFlight review submissions in 24 hours. GitHub's release
queue serializes builds through review submission, but it cannot hold the lock
until Apple approves them. If a later same-version release fails while another
build is in review, wait for that review to finish, select the newest processed
pending build, and run the ASC recovery workflow with
`submit_beta_review=true`. Do not rebuild or submit superseded pending builds.

### Capability or entitlement changes

Apple provisioning profiles capture the app's entitlements when they are
created. Capabilities needed before Expo prebuild must be declared in
`ios.entitlements`; `ios.associatedDomains` is mirrored there for that reason.
After changing either field, an Expo config plugin, or a native target's
entitlements, regenerate only the affected profile before releasing:

```bash
cd apps/ios
eas credentials -p ios
```

Choose `production`, log into Apple, open **Build Credentials**, delete the
affected target's provisioning profile, then choose **All** and generate a new
profile while reusing the distribution certificate. Do not delete unrelated
share-extension or widget profiles. The local signing preflight is the
enforcement gate; `--clear-cache` does not refresh signing credentials.

The build appears in App Store Connect → TestFlight → the automatic internal groups after processing. The external `friend-testers` build then advances through Apple's Beta App Review. Routine production workflow success means the group assignment and review request were submitted successfully; it does not mean Apple approved the build or that a tester's phone installed it. TestFlight Automatic Updates can install only after Apple makes that build externally available.

Public join URL (landing CTA): https://testflight.apple.com/join/yvYrrxbM

### Tester groups

The populated external group is `friend-testers`, backed by the public link above. Every successful two-job production release adds its exact build automatically and submits it for review. Apple controls review and availability; testers control whether TestFlight's Automatic Updates setting installs an approved build on their devices.

The Expo project is connected to App Store Connect app `6798832989`. Verify the connection and both schemas from `apps/ios` with `eas integrations:asc:status --json`, `eas workflow:validate .eas/workflows/testflight-production.yml --non-interactive`, and `eas workflow:validate .eas/workflows/testflight-external.yml --non-interactive`.

### Rollback

Expire the broken build in App Store Connect. To restore group membership for
a still-valid, unexpired, previously approved build, run the ASC recovery
workflow with that exact build ID and without requesting another review:

```bash
cd apps/ios
eas workflow:run .eas/workflows/testflight-external.yml \
  --input asc_build_id=VALID_PRIOR_ASC_BUILD_ID \
  --input submit_beta_review=false \
  --non-interactive \
  --wait
```

If no valid prior build exists, cut a new production release. Do not roll back
with a generic latest lookup or by re-uploading an arbitrary prior EAS build.

## Landing page → Docs

The landing page reads `docs/*.md` at build time. Any doc change requires a landing deploy to appear on `/docs/*`. This is intentional — production docs are always tagged with a specific commit.
