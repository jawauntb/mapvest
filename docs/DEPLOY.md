# Deploy

Mapvest has three production delivery paths:

1. **Railway** — API, landing page, and Postgres.
2. **TestFlight** — an explicit exact iOS release candidate.
3. **App Store** — protected exact-ID review and storefront release.

## Railway

### First-time project setup

```bash
railway login
railway init
railway link
```

Create `api` from `apps/api`, `landing` from `apps/landing`, and attach
Postgres. Shared Massive credentials remain authoritative in Doppler
`shared/prd`; service-specific Mapvest values may use `mapvest/prd`. See
`infra/doppler/README.md` for the separation. Never copy provider credentials
into source or a release artifact.

Railway auto-deploys the API and landing page from `main`. Manual API recovery:

```bash
railway up --service api
```

After API deployment, verify `/v1/health` and refresh a pre-existing saved
Research thread from an internal account. This read-only check should not admit
a generation or spend quota. Compare service configuration without printing or
rotating secrets if it fails.

Production domains:

- Landing: `https://mapvest.app` (`www` is the Railway custom domain; apex
  redirects at GoDaddy).
- API: `https://api-production-4b27.up.railway.app`.

## iOS release controls

The detailed operator guide is `apps/ios/DEPLOY_TESTFLIGHT.md`. The short
contract is below.

### Static release manifest

`apps/ios/release/v0.1.0.json` is the versioned source for TestFlight, Beta
Review, App Store, App Review, product-page themes, reviewer walkthrough, and
evidence requirements. Its `contentHash` makes copy/config drift detectable.
Validate or render it locally without credentials:

```bash
cd apps/ios
bun scripts/release-manifest.ts validate release/v0.1.0.json
bun scripts/release-manifest.ts render release/v0.1.0.json testflight
```

The iOS candidate workflow does not run after every green `main` merge.
Intermediate concern merges therefore cannot create stale TestFlight builds.
Only an explicit dispatch containing the validated manifest path/hash and the
full current merged `main` SHA can enter the protected
`ios-production-release` environment:

```bash
gh workflow run ios-eas-production.yml --ref main \
  -f manifest_path=apps/ios/release/v0.1.0.json \
  -f manifest_hash=sha256:VALIDATED_HASH \
  -f source_commit_sha=FULL_CURRENT_MAIN_SHA
```

The job rechecks current `main`, app/manifest marketing-version equality, a
clean checkout, Xcode 26 production signing, every EAS workflow schema, and no
active EAS release. It records and waits on one exact build run ID, downloads
that exact EAS IPA, and verifies its app/widget identity, privacy, entitlements,
and hash before a separate workflow distributes the recorded EAS build UUID.
The external group (`friend-testers` for this release) and What to Test are
rendered from the same manifest. Nothing selects a generic newest build.

### Runtime ledger

The immutable static manifest is not rewritten after build. A separate private
runtime ledger artifact binds its hash and source SHA to build number, exact EAS
build ID, programmatically resolved ASC build and App Store version IDs, the
inspected IPA hash, workflow/attestation evidence, review submission ID, and
state history. `ios-release-ledger` creates it only from a successful candidate
run and protected confirmations. Each successful App Store workflow emits the
same deterministic ledger artifact name in its own run, so the next protected
step can resume its recorded state. Recovery inspects and resumes those records.
The artifact contains no key, bearer, review password, tester email, raw photo,
or precise location.

### TestFlight recovery

An already processed upload may be assigned or resubmitted to Beta Review with
the protected `ios-testflight-recovery` GitHub workflow. Supply the exact ASC
resource ID and original manifest binding; the wrapper derives What to Test and
the external group from that manifest. The recovery path performs no build and
never `--latest`.

Public group: `friend-testers`

Public link: https://testflight.apple.com/join/yvYrrxbM

### App Store Review and release

`.github/workflows/ios-app-store-release.yml` has three modes:

- `dry-run` validates identity, metadata, agreements attestation, evidence,
  and planned mutations without changing App Store Connect.
- `submit` attaches/read-backs the exact build and uses current
  `reviewSubmissions` and `reviewSubmissionItems` resources.
- `release` requires a separately approved protected environment and acts only
  on the recorded approved version.

Configure `app-store-review-submission` and
`app-store-production-release` as protected GitHub environments with required
reviewers. The latter is the second storefront-release approval. Both use a
narrow `DOPPLER_TOKEN`; ASC values live only in Doppler `mapvest/prd` as
`APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, and
`APP_STORE_CONNECT_PRIVATE_KEY`. Store the private key as single-line base64;
multiline or raw PEM is rejected before masking. The workflow retrieves it only
after its no-credential preflight and mints a short-lived JWT. Use a dedicated
least-privileged App Manager key; rotate it every 90 days and immediately after
suspected exposure or an operator departure.

Retries inspect the same recorded IDs after ambiguous responses. Conflicting
submissions, invalid/expired builds, missing metadata/privacy/reviewer or
subscription information, agreement or role gates, 409/422 responses, and
rate limits stop without blind creation. Deprecated
`appStoreVersionSubmissions` is not used.

Always report upload, TestFlight, Beta Review, App Review, approval, release, and storefront availability
separately. A release request is `PROCESSING_FOR_DISTRIBUTION`; availability is
true only after the exact recorded version reads back as
`READY_FOR_DISTRIBUTION`.

### Native and secret gates

EAS owns the build number through `cli.appVersionSource: remote` and production
`autoIncrement`. The widget inherits `$(MARKETING_VERSION)` and
`$(CURRENT_PROJECT_VERSION)`; do not hard-code extension versions. Signed
archive inspection must prove app/extension version parity, the intended App
Group, privacy manifests, and no secrets.

Provisioning profiles capture entitlements. After changing an entitlement or
native target, regenerate only the affected profile with `eas credentials -p
ios`, reuse the distribution certificate, and leave unrelated targets intact.
The Xcode 26 signing preflight is the enforcement gate.

## Landing page docs

The landing page reads `docs/*.md` at build time. A doc change appears publicly
only after the landing deployment for that commit.
