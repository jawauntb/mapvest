# TestFlight and App Store release runbook

Mapvest does not run after every green `main` merge. Ordinary merges can deploy
the API and landing page, but an iOS release candidate exists only after an
operator explicitly supplies a validated release manifest, its immutable hash,
and the full current `main` SHA to `ios-eas-production`.

The checked-in static manifest is `release/v0.1.0.json`. It is the only source
for TestFlight What to Test, Beta Review notes, App Store What’s New, App Review
notes, product-page themes, reviewer steps, version expectation, and evidence
requirements. The `contentHash` is the SHA-256 of canonical manifest content
excluding the hash field itself. Do not edit copy in a workflow.

Validate and render it without making a release:

```bash
cd apps/ios
bun scripts/release-manifest.ts validate release/v0.1.0.json
bun scripts/release-manifest.ts render release/v0.1.0.json testflight
bun scripts/release-manifest.ts render release/v0.1.0.json beta-review
bun scripts/release-manifest.ts render release/v0.1.0.json app-store-whats-new
bun scripts/release-manifest.ts render release/v0.1.0.json app-review
```

## Candidate TestFlight build

Before dispatch, merge all release concerns, wait for CI, and record the exact
current `main` SHA. Dispatch only that SHA and the hash printed by validation:

```bash
gh workflow run ios-eas-production.yml --ref main \
  -f manifest_path=apps/ios/release/v0.1.0.json \
  -f manifest_hash=sha256:VALIDATED_HASH \
  -f source_commit_sha=FULL_CURRENT_MAIN_SHA
```

GitHub checks out the supplied SHA, proves it is still current `main`, validates
the manifest/hash/version binding, and enters the protected
`ios-production-release` environment. Configure that environment with required
reviewers plus the `EXPO_TOKEN` and narrowly scoped `DOPPLER_TOKEN` secrets. A
local Xcode 26 signing build runs before the EAS cloud build. EAS receives the
same manifest hash and SHA and builds once. GitHub then downloads that exact IPA,
verifies its app/widget identity, privacy manifest, entitlements, and SHA-256,
and only then passes its exact EAS build UUID to a separate TestFlight workflow.
What to Test and the `friend-testers` group are rendered from the manifest, and
the workflow requests Beta App Review.

The production runner still refuses dirty source and active/orphaned production
runs, persists one exact EAS workflow run ID, adopts only an unambiguous lost
dispatch, and cancels/reconciles that exact run after ambiguous waits. The
manifest inputs add identity to those existing exact-run protections.

EAS owns the monotonically increasing app build number. The widget uses
`$(MARKETING_VERSION)` and `$(CURRENT_PROJECT_VERSION)` rather than literals,
so the containing app and extension inherit the same values. Archive inspection
remains the authoritative check for matching versions, App Group entitlement,
privacy manifests, and absence of secrets.

## Runtime release ledger

The static manifest never receives EAS or App Store Connect results. After the
candidate succeeds, dispatch `ios-release-ledger` with that GitHub run ID, the
same manifest binding, and every explicit release attestation set to true. The
protected workflow verifies the candidate workflow path, conclusion, and source
SHA; downloads its exact distributed-candidate evidence; resolves the matching
processed ASC build and iOS App Store version through Apple; and creates a
private runtime ledger. The ledger records exact IDs, the IPA hash, workflow-run
provenance for every automated gate, protected operator attestations, observed
review state, and bounded state history. Each successful dry-run, submit, or
release workflow publishes the same deterministic ledger artifact name in its
own run; the next run must name that successful protected producer. This forms
a verified state chain without rewriting the manifest or inferring a newest build.

Never place a bearer, provider key, review password, private key, tester email,
raw photo, or precise location in either artifact. Evidence should be an opaque
artifact reference, not sensitive content.

## Exact TestFlight recovery

If upload succeeded but external distribution failed, invoke the protected
GitHub recovery workflow with the processed ASC build resource ID and original
manifest binding:

```bash
gh workflow run ios-testflight-recovery.yml --ref main \
  -f asc_build_id=EXACT_PROCESSED_ASC_BUILD_ID \
  -f manifest_path=apps/ios/release/v0.1.0.json \
  -f manifest_hash=sha256:VALIDATED_HASH \
  -f source_commit_sha=FULL_MERGED_MAIN_SHA \
  -f submit_beta_review=true
```

The GitHub wrapper derives copy and group from the checked-in manifest; neither
is a free-form recovery input. The ASC value is the resource ID, not the visible
build number or EAS ID. For a still-valid build already approved for external
testing, recovery may use `submit_beta_review=false`. It never selects a generic
newest build.

## Protected App Store Connect automation

App Store review/release uses `.github/workflows/ios-app-store-release.yml` and
the current `reviewSubmissions` plus `reviewSubmissionItems` resources. It never
uses deprecated `appStoreVersionSubmissions` and never `--latest`.

Configure GitHub before any live dry-run:

- `app-store-review-submission`: required reviewer; secret `DOPPLER_TOKEN`;
  environment variable `MAPVEST_ASC_AGREEMENTS_CONFIRMED=true` only after the
  account holder verifies current agreements.
- `app-store-production-release`: a separate required reviewer for the second
  storefront-release approval; the same narrowly scoped Doppler access.
- `ios-production-release`: required reviewer, `EXPO_TOKEN`, and a narrowly
  scoped `DOPPLER_TOKEN` used by the ledger workflow to resolve exact ASC IDs.
- Doppler `mapvest/prd`: `APP_STORE_CONNECT_KEY_ID`,
`APP_STORE_CONNECT_ISSUER_ID`, and `APP_STORE_CONNECT_PRIVATE_KEY` for a
least-privileged App Manager key dedicated to this automation. Store the private
key as single-line base64; raw or multiline PEM is rejected before masking.

The workflow validates the merged-main SHA, static manifest, runtime ledger,
and exact IDs before installing Doppler or retrieving ASC credentials. The key
is masked, used only to mint a ten-minute JWT, and never written to the ledger.
Rotate it every 90 days and immediately after suspected exposure or an operator
departure; revoke the previous key after the replacement dry-run passes.

Start with `mode=dry-run`. It reads the exact app, version, build, attachment,
metadata, review details, agreements attestation, and evidence; it reports
planned mutations and makes none. `mode=submit` attaches and reads back the
exact build, adopts or creates one `READY_FOR_REVIEW` review submission and
item, and submits it. Ambiguous responses return to inspection of those same
records. Conflicts, 409/422 errors, invalid/expired builds, missing metadata,
role failures, or rate limits stop with the ledger resumable.

After Apple approval, invoke a new workflow run with the updated approved
ledger and `mode=release`. The separate production environment supplies the
second approval. Release mode acts only when the recorded version is
`PENDING_DEVELOPER_RELEASE`; a request is tracked as
`PROCESSING_FOR_DISTRIBUTION`, and availability is reported only after that exact
version reads back as `READY_FOR_DISTRIBUTION`.

Treat upload, TestFlight, Beta Review, App Review, approval, release, and storefront availability
as distinct states. A green EAS workflow is not Apple approval, a successful
review submission is not release, and an accepted release request is not proof
of storefront availability.

## Break-glass boundaries

The direct `bun scripts/testflight-production.ts` entry point is retained only
for guarded recovery. It now requires the four `MAPVEST_RELEASE_*` identity
variables, including a manifest path and hash, and performs the same validation
before contacting EAS. Confirm GitHub and EAS have no nonterminal release first.

Do not run the App Store script directly for routine operations. The protected
workflow supplies merged-main checks, environment approval, Doppler access,
artifact retention, and the second release approval that a local shell cannot
prove.

Public TestFlight group: `friend-testers`

Public join URL: https://testflight.apple.com/join/yvYrrxbM

Support: jawaun@generalintelligencecompany.com
