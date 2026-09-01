---
title: First Run, Nearby Quest, Notifications, and App Store Release - Plan
type: feat
date: 2026-09-01
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
deepened: 2026-09-01
---

# First Run, Nearby Quest, Notifications, and App Store Release

## Goal Capsule

Ship the first public-ready Mapvest iOS release with a live first-run quickstart, a useful Nearby Quest home-screen widget, opt-in notifications that open the right in-app context, and an auditable exact-build path from the merged commit through TestFlight and App Store Review. Preserve the existing public nearby API, device-scoped push consent, account isolation, sourced-finance rules, and the user's ability to release only the verified binary.

Success means Mapvest first proves its value to the primary ICP — curious self-directed retail investors who notice a brand or place and want a sourced path from “what company is this?” to “how can I invest?” — before asking for durable commitment. After authentication, a permission-decided user can complete the active Map-to-two-companies-to-Research mission in under one minute on a healthy connection. The release candidate passes repository checks; generated native projects build on Xcode 26; onboarding, widget, and notification state cannot leak across accounts; and App Store automation can submit only the exact processed build associated with the active release manifest.

## Product Contract

### Actors

- **Primary ICP — curious self-directed retail investor.** Notices brands, products, and nearby places and wants a fast, sourced path from recognition to a public ticker, comparable, ETF exposure, collection, and optional deeper Research.
- **Guest explorer** — can see a non-personal nearby discovery widget without signing in.
- **Signed-in explorer** — can see Nearby Quest progress and receive only explicitly enabled notification categories.
- **Returning or switching user** — must never see another account's widget state or act on another account's delayed push.
- **App reviewer and beta tester** — needs accurate instructions, a stable authentication path, and an informational-finance explanation.
- **Release operator** — can inspect, dry-run, submit, resume, and release one exact build without using “latest.”
- **First-time explorer** — can skip or complete a live guided mission that creates real, durable product value rather than dismissing slides.

### Requirements

- **R1 — Additive API only.** Keep `GET /v1/widget/nearby` and the existing quest, dex, and find routes as the widget data sources; do not add a news or price contract. Add only the Local Brief readiness/area/source proof, immediate Research admission mode, account deletion, and push-delivery fields required by this release, with backward-compatible defaults and regenerated contracts.
- **R2 — Atomic widget truth.** A widget entry uses one versioned, app-synchronized snapshot so location, discovery cards, quest progress, account scope, freshness, and deep links cannot be mixed from different writes.
- **R3 — Honest, useful widget states.** A healthy snapshot shows the nearest sourced investable, why it is relevant, discovery status, quest/dex progress, freshness, and one exact Map/company tap target. Every supported family otherwise renders an explicit setup, empty, stale, offline, permission, or refresh-in-app state. Personalized words such as “uncaught” appear only when the current account snapshot proves them.
- **R4 — Minimal shared and diagnostic data.** The widget shared container may hold display-ready tickers, names, place IDs, coarse display distances, quest/dex totals, timestamps, scope/epoch identifiers, and target paths; it may not hold bearer tokens, emails, raw photos, provider keys, or precise coordinates. Those excluded values also stay out of logs, crash reports, analytics events, and release evidence. On a locked device, personal watchlist/quest details use the non-personal guest presentation until protected data is available after unlock.
- **R5 — Explicit notification consent and earned cadence.** Never prompt on launch or silently enable categories. Treat provisional authorization as usable, route denied users to system settings, and keep per-category server preferences visible and reversible. Launch with Research Ready plus one earned Nearby Discovery alert only after demonstrated map/save interest, include a plain-language relevance reason, and cap Nearby Discovery at one alert per day and three per week.
- **R6 — Account-safe delivery.** Each push delivery carries an opaque installation token ID, unique delivery ID, issue/expiry time, event kind, and typed target context. The client rejects malformed, expired, duplicated, or account/installation-mismatched responses before navigation.
- **R7 — Useful notification destinations.** Nearby alerts open the Map centered on and highlighting the intended place or ticker; company and research alerts open their relevant detail. Missing or offline targets fall back visibly instead of navigating to unrelated content.
- **R8 — Safe actions.** Notification actions in this release are foreground navigation actions: View on Map, View Company, and Notification Settings. Passive callbacks do not create finds, save companies, request permissions, or mutate preferences.
- **R9 — One release manifest and public story.** TestFlight “What to Test,” Beta Review notes, App Store “What’s New,” review notes, version/build identity, commit SHA, evidence references, release mode, ICP-facing subtitle/description/keyword theme, and screenshot narrative come from one validated versioned manifest rather than duplicated workflow literals. Static copy/config receives an immutable content hash; a separate runtime release ledger binds processed EAS/ASC IDs and evidence to that hash without rewriting the checked-in manifest.
- **R10 — Exact-build state machine and protected credentials.** App Store automation resolves and verifies bundle ID, marketing version, build number, EAS build UUID, ASC build ID, App Store version ID, release-manifest hash, and submission state before mutation; retries inspect and resume the same records. A protected production environment admits only an allowlisted merged `main` SHA, requires release approval, loads a least-privileged App Store Connect key from Doppler only after validation, masks all credentials, and requires a second approval before storefront release. Credentials rotate on suspected exposure, operator departure, or the documented fixed interval.
- **R11 — Public-release gate.** App Store Review submission occurs only after the exact merged build is valid in App Store Connect and all automatable verification is green. Availability is reported only when App Store Connect confirms storefront availability.
- **R12 — Informational positioning.** Release text and in-app Research output describe Mapvest as sourced company and market discovery, not brokerage, trade execution, portfolio management, or personalized investment advice. Sourced discovery leads public copy; quest language is secondary delight inside collection/progress surfaces.
- **R13 — Live optional quickstart.** Replace the one-bit first-open sheet with a resumable guided journey through Map, Local Brief, Camera, collection, and Research. The user may skip at any point and restart from Home or Settings.
- **R14 — Two real companies.** Mission completion requires two distinct effective tickers confirmed by server truth: at least one explicit nearby Map save in watchlist and one sourced Camera or photo-library identification recorded as a Universe Find. A duplicate ticker triggers another real selection. If no distinct object resolves, preserve the first save and enter a deferred Camera checkpoint that resumes later instead of fabricating completion.
- **R15 — Value-first auth and contextual permissions.** A guest may inspect one live nearby company before authentication; authentication is requested when the user saves, starts the durable mission, or opens Research. Foreground location and camera permissions are requested only after the dependent action, with selected-map-area, photo-library, Settings, retry, defer, and skip paths. Notification permission is not requested during quickstart.
- **R16 — Brief, activation, and Research proof.** First activation is the first sourced real-world company result plus an explicit confirmed save. Mission completion additionally requires a `ready` Local Brief with non-empty valid sources and matching requested-area identity, plus an explicitly user-sent Research request immediately accepted with a conversation ID and client message ID. Loading, degraded, stale/mismatched, prefilled, queued, or optimistic states do not count.
- **R17 — AI transparency and enforced data path.** Before the first image or Research transfer, disclose exact data categories, purpose, named processors/fallbacks, retention/training posture, and deletion limits. Transfers are brokered by the Mapvest backend with no long-lived provider credential in the client, request/response bodies are excluded from logs, and versioned consent is required per transfer class. Declining performs no transfer, ends the quickstart as skipped without a same-run re-prompt, and leaves browsing/saving usable; the mission can resume only after later consent.
- **R18 — Deletion readiness and revoked identity.** A signed-in user can initiate permanent account deletion in app after recent reauthentication, typed destructive confirmation, and a short-lived single-purpose deletion grant. Before deletion starts, shared widget state receives a deletion-pending marker and renders non-personal content. The server persists a deleted-subject tombstone for at least the maximum JWT lifetime, rejects stale tokens before any user recreation, revokes device claims, executes the documented first-/third-party data lifecycle, and returns an idempotent operation status. Local cleanup resumes fail-closed before another sign-in.

### Key Decisions

- **KD1 — Nearby Quest is the widget promise.** Governs R1–R4. The widget emphasizes nearby companies and personal discovery progress, not time-sensitive news or unsourced market moves.
- **KD2 — Notifications remain post-value and opt-in.** Governs R5–R8. Settings and existing post-discovery surfaces explain value before the operating-system prompt.
- **KD3 — Release identity is immutable, exact, and concern-scoped.** Governs R9–R12. Release infrastructure, push safety, widgets, onboarding/AI consent, and deletion land as separate reviewed PRs. A validated manifest trigger produces the sole release-candidate TestFlight build after all concerns merge; submission, recovery, and release use recorded IDs, never “latest.”
- **KD4 — The first run is a live mission, not a carousel.** Governs R13–R17. Progress advances only from observed product outcomes and remains resumable across termination.
- **KD5 — Release compliance is product behavior.** Governs R18. Account deletion and AI-sharing consent ship as user-visible capabilities rather than review-note promises.

### Key Flows

- **F1 — Widget discovery.** The user opens Mapvest; the app synchronizes nearby and account discovery state; it atomically writes and reloads a snapshot; every widget family renders the same truth with family-appropriate density; a tap opens the exact Map or company context.
- **F2 — Notification opt-in and delivery.** The user enables a category after seeing its value; the app obtains or recognizes usable permission, registers the installation, persists the category choice, receives an account-scoped delivery, admits it once, and opens its typed target.
- **F3 — Account transition.** Before sign-out or account activation completes, Mapvest revokes the push claim, clears shared widget and replay state, reloads widgets, and only then permits the next account to populate them.
- **F4 — Exact release.** Concern-scoped changes merge without producing release candidates. The final validated manifest trigger records one merged SHA and produces one EAS build; TestFlight uses the same manifest hash; App Store automation resolves that exact ASC build, validates metadata, attaches it to the intended version, submits one review item, and records each observed state through availability.
- **F5 — One-minute quickstart.** A persistent collapsible mission card lets a guest preview one live nearby company. After auth, Map races Nearby and Local Brief; the user saves one real nearby company; Camera or photo library identifies a distinct investable and records a Find; server collection truth reaches two; Research opens with editable two-company/brief context; the user sends; immediate admission completes the mission. The card stays available across Map, Camera, and Research with four-step progress, one next action, and an always-visible Explore on my own exit.
- **F6 — Account deletion.** The user opens Settings, reviews what deletion removes, completes recent reauthentication and typed confirmation, then the client writes deletion-pending shared state and submits one stable operation. An ambiguous result is resolved through status inspection and safe retry; server authority becomes tombstoned before rows disappear, and client cleanup resumes before guest mode.

### Acceptance Examples

- **AE1 — Guest widget.** Given no signed-in account, when nearby public data is fresh, then the widget says “Explore” rather than “uncaught” and opens Map without exposing personal state.
- **AE2 — Account switch.** Given Account A populated a quest widget and received a push, when the user signs into Account B, then A's widget progress disappears and tapping A's delayed notification performs no navigation.
- **AE3 — Stale widget.** Given the last good snapshot is older than its freshness window and refresh fails, then the widget labels the content stale and offers an open-app refresh rather than showing a blank or fresh-looking card.
- **AE4 — Nearby push.** Given an admitted uncaught-nearby alert with a valid place ID, ticker, and coordinates, when tapped from a terminated app, then navigation waits for session hydration and Map highlights the target after nearby data loads.
- **AE5 — Duplicate push.** Given the same delivery response arrives twice, then only the first response is marked and routed; the second is ignored without side effects.
- **AE6 — Exact submission.** Given two processed ASC builds exist for the same marketing version, when the release job receives one recorded build ID, then it verifies and submits only that build or stops; it never chooses the newest build implicitly.
- **AE7 — Quickstart resume.** Given the app terminates after the Map save, when the same account returns, then the mission resumes at Camera and re-derives the saved company from the server without duplicating it.
- **AE8 — Duplicate discovery.** Given Camera resolves to the same effective ticker saved from Map, then the mission remains at one of two and offers another real nearby selection.
- **AE9 — Permission decline.** Given location or camera permission is denied, then Mapvest offers an honest alternative, Settings/retry, and skip without repeating the system prompt or marking the step complete.
- **AE10 — Research completion.** Given two companies and a ready Local Brief, when the user reviews and sends the seeded prompt, then completion waits for one accepted conversation ID and remains idempotent for the same client message ID.
- **AE11 — Account deletion.** Given a confirmed deletion succeeds server-side but local cleanup is interrupted, then the deleted account cannot be reactivated or receive pushes and the client resumes required cleanup before another sign-in.
- **AE12 — Offline quickstart.** Given a save or Find cannot be confirmed, then the journey keeps earned progress, shows an honest retry state, and resumes confirmation after reconnect without repeating permissions or recapturing a locally retained upload reference.
- **AE13 — Sparse surroundings.** Given Camera cannot resolve a distinct sourced ticker, then photo-library recovery is offered; if it still cannot resolve, the first confirmed save remains and the Camera checkpoint is deferred to a later session without false completion.
- **AE14 — Deleted token.** Given deletion reaches the server authority boundary, when any old bearer is replayed, then auth rejects its tombstoned subject before user lookup or creation and a later magic-link registration receives a new subject.
- **AE15 — Invalid release build.** Given the recorded build is rejected, expired, or superseded by a required fix, then a new manifest version and runtime ledger entry record the replacement while preserving prior immutable evidence; automation refuses any identity not bound to the active manifest.

### Scope Boundaries

#### In Scope

- iOS Nearby Quest widget presentation using the current WidgetKit infrastructure; the existing Android widget remains unchanged.
- Versioned local discovery snapshots and fail-closed account lifecycle cleanup.
- Additive per-recipient push delivery context, admission/replay defense, notification categories, and highlighted-map routing.
- Versioned release copy, exact-build App Store Review automation, metadata validation, recovery, and status evidence.
- Native signing, privacy-manifest, simulator/build, automated release dry-run, and post-merge TestFlight verification gates available to this environment.
- Live, skippable onboarding with resumable checkpoints, just-in-time AI disclosure, timing instrumentation, and server-truth completion.
- In-app account deletion and its server/device cleanup path.

#### Deferred to Follow-Up Work

- A cited news widget or real-time price widget; both need finance-source and freshness contracts.
- WidgetKit push updates and interactive App Intents; the current iOS 16 floor and opportunistic timeline refresh are sufficient.
- Mutating notification actions such as Catch, Save, or Mute This Type.
- Expanding the research agent into a general app-settings agent.
- An Expo SDK upgrade to the official widgets package.
- Android widget snapshot parity and presentation redesign; re-verify all atomicity, account isolation, and data-exclusion guarantees when adopting the official cross-platform widget path.
- Guest-side durable Universe/watchlist staging; the current product contract requires authentication to persist.
- A finished long-form memo inside the one-minute SLO; Research admission and visible in-progress response are sufficient for this release.

#### Outside This Release

- Brokerage connectivity, trade execution, personalized investment advice, or automatic portfolio actions.
- Letting the consumer research agent request operating-system permissions, manage widgets, hold release credentials, or publish an app version.
- Silent watchlist seeding, auto-sent AI prompts, timed auto-advance, or permission prompts unrelated to the action the user chose.

## Assumptions

- The user-authorized release target is `com.mapvest.app` in App Store Connect app `6798832989`.
- Public App Store submission is authorized, but automation must stop if required agreements, privacy answers, screenshots, reviewer credentials, subscription review data, or permissions are incomplete.
- The existing public nearby widget API is production-compatible. Additive Local Brief readiness, immediate Research admission, push-delivery, and deletion contracts land in their concern-scoped PRs and remain compatible with the deployed client until the explicit release candidate.
- App Review submission uses a protected explicit workflow and preserves a final release gate until the exact build has passed its TestFlight evidence checklist; the same workflow can then perform the user-authorized release for that recorded version.
- This host's older local Xcode and Java runtimes are not accepted as native proof; Xcode 26 EAS/GitHub runners and JDK 17-capable CI own those gates.
- “Under one minute” measures `journeyActiveMs` from the first interactive Map/Brief screen after auth until accepted Research admission. The clock pauses only while an operating-system permission sheet is visible or the app is backgrounded; capture/search interaction remains included. `totalElapsedMs` and `externalWaitMs` are recorded separately. Email auth, pre-auth exploration, and system-sheet dwell are outside the SLO.
- The post-merge SLO sample is at least twenty fresh-account instrumented TestFlight runs across the oldest supported iPhone/iOS pair and a current iPhone/iOS pair, balanced across warm/cold service state and stable Wi-Fi/LTE/5G. A median above 60 seconds blocks App Review unless a written, user-approved waiver is bound to the release ledger; p90 is always reported.
- First-run state is account-scoped on the device. Mature accounts with both a qualifying nearby Map save and a distinct sourced Camera Find start at Brief/Research; accounts with only one qualifying origin start at the missing step. Other existing accounts receive orientation without being marked mission-complete or entering the first-run SLO sample. Guest and skipped states never borrow another account's completion.

## Planning Contract

### Key Technical Decisions

- **KTD1 — App-authored atomic snapshot** *(session-settled: user-directed — chosen over independent widget fetch/composition: it prevents mixed account, quest, and location state while making the widget more useful).* One `WidgetDiscoverySnapshotV1` is written atomically after app synchronization. Native extensions render it and may show its last-good state, but do not independently join personalized state to a public fetch. Implements R2–R4 and KD1.
- **KTD2 — Navigation-only notification actions** *(session-settled: user-directed — chosen over one-tap financial mutations: the user asked for useful notifications, and foreground navigation preserves authentication and retry semantics).* Implements R5–R8 and KD2.
- **KTD3 — Per-recipient delivery admission** *(session-settled: user-directed — chosen over clearing the last Expo response: clearing alone cannot prove a delayed response belongs to the current installation/account).* The server supplies opaque delivery context; the client marks a bounded replay ledger before routing. Implements R6–R8.
- **KTD4 — One release manifest and exact ASC records** *(session-settled: user-directed — chosen over duplicated copy and latest-build helpers: release copy and binary identity must remain auditable after ambiguous network responses).* Implements R9–R12 and KD3.
- **KTD5 — Concern-scoped PRs and one explicit release trigger** *(session-settled: repository rule — chosen over one oversized PR: release infrastructure, push safety, widgets, quickstart/AI consent, and deletion need independent review and rollback).* First change the green-main iOS workflow to require a validated release-manifest trigger; land each concern separately; then use one release-integration PR and exact merged SHA to produce the sole candidate build.
- **KTD6 — Versioned outcome-driven quickstart** *(session-settled: user-directed — chosen over the current one-bit sheet or a carousel: the user asked to accomplish the real tasks, and only observed outcomes prove that).* Persist account-scoped checkpoints and operation IDs, then re-derive collection truth from server finds/watchlist. Implements R13–R16 and KD4.
- **KTD7 — Signed-in timed SLO** *(session-settled: user-directed — chosen over a false fresh-install guarantee: email, system-sheet dwell, and provider waits are not app-controlled).* Target accepted Research admission within 60 active seconds after auth, pausing only for a visible OS permission sheet or backgrounding while recording total and external-wait time separately. Implements R13–R16.
- **KTD8 — User-approved AI boundary** *(session-settled: user-directed — chosen over implicit transfer: Apple requires explicit disclosure before sharing personal data with third-party AI).* Keep camera and Research consents scoped, named, revocable for future transfers, and independent of map/save use. Implements R17 and KD5.
- **KTD9 — Tombstoned, grant-bound account deletion transaction** *(session-settled: user-directed — chosen over a support-only request: App Store rules require in-app initiation and the release should not depend on a promise outside the binary).* Recent magic-code reauthentication mints a short-lived, single-use deletion grant bound to user, operation ID, request digest, and nonce. Persist a deleted-subject tombstone and terminal operation status before dependent cleanup; revoke push claims; retain the tombstone through maximum JWT TTL; and keep interrupted client cleanup fail-closed. Implements R18 and KD5.

### Alternatives Considered

- **News-first widget:** rejected because WidgetKit refresh is opportunistic and the current widget contract lacks cited news/freshness data.
- **Live-price movement widget:** rejected because the existing widget price fields lack source metadata required by Mapvest's finance contract.
- **Widget-direct personalized API access:** rejected because extensions must not receive bearer credentials and cannot safely join account state with location independently.
- **Prompt on first launch:** rejected because Apple recommends contextual permission requests and Mapvest already has post-value surfaces.
- **Deprecated App Store version submission resource or “latest” build:** rejected in favor of current review-submission resources and exact IDs.
- **Automatic storefront availability immediately after approval:** deferred behind the recorded TestFlight evidence gate because a public binary has no true rollback.
- **Guest-first durable quickstart:** rejected because Local Brief is bearer-only and guest Camera identifications do not create Universe Finds; faking local membership would violate persistence truth. A non-durable guest preview of one real nearby company remains in scope so auth follows initial product proof.
- **Auto-save two companies:** rejected because collection side effects need an explicit user action; use one explicit Map save plus Camera's disclosed automatic Find.
- **Count a prefilled Research draft or finished memo:** rejected because a draft proves no user intent while a terminal memo can take minutes; count one accepted user send and let the response continue.

### High-Level Technical Design

These sketches describe boundaries and state transitions, not implementation syntax.

#### Widget data flow

```text
public nearby + signed-in quest/dex/find state + active account epoch
                              |
                              v
                   app snapshot composer
                              |
                  atomic versioned write
                              |
                              v
                    protected App Group
                              |
                              v
                    WidgetKit timeline
                              |
                              v
                  honest state + exact link
```

#### Snapshot decision table

| Snapshot state | Personal language | Display | Tap |
|---|---:|---|---|
| Missing/corrupt | No | Setup or open-app refresh | Map/home |
| Guest fresh | No | Nearby exploration | Map/place |
| Account and epoch match | Yes | Quest/dex plus nearby target | Exact target |
| Account or epoch mismatch | No | Clear and setup | Sign-in/home |
| Expired with last good | Only if scope still matches | Stale label and last good | Refresh in app |

#### Notification lifecycle

```text
post-value explanation -> OS permission -> token claim -> category preference
        -> server event -> unique recipient delivery envelope -> device receipt
        -> hydrate session -> validate scope/expiry -> mark pending -> navigate
                -> durable target handoff -> mark handled
        -> restart retries unexpired pending; malformed/mismatch/duplicate rejects
```

#### Exact-build release state machine

```text
manifest validated
      -> merged SHA verified
      -> EAS build recorded
      -> ASC build VALID and identity matched
      -> TestFlight distribution and exact-build evidence satisfied
      -> store metadata complete
      -> exact build attached and read back
      -> READY_FOR_REVIEW submission/item adopted or created
      -> submitted
      -> in review / rejected / approved
      -> exact version released
      -> storefront availability confirmed
```

Ambiguous create or submit responses return to inspection of the same recorded IDs. A conflicting active submission, invalid build, missing metadata, or account-level Apple gate stops without creating another draft.

#### First-run outcome state machine

```text
not started
   -> guest sees one live nearby company (untimed)
   -> auth continuation on save/start/Research (untimed)
   -> map + Local Brief ready
   -> one explicit Map save confirmed
   -> camera consent + camera/photo permission sheet (clock paused only for sheet)
   -> sourced Camera or photo-library Find confirmed
   -> two distinct server-side companies confirmed
   -> user reviews and sends Research prompt
   -> accepted conversation ID
   -> completed
```

Skip records dismissal, not completion. Termination resumes the next incomplete checkpoint for the same account; account changes clear staged presentation state and re-derive product truth. Permission-denied, duplicate-ticker, degraded-brief, queued-upload, quota, and offline paths remain retryable.

#### One-minute budget

| Product-controlled stage | Target on healthy connection | Proof |
|---|---:|---|
| Nearby ready | 5 seconds | Real investables rendered |
| Local Brief ready, prefetched in parallel | 12 seconds | Non-degraded sourced brief rendered |
| Camera identify | 20 seconds | Sourced investable/comparable returned |
| Collection reconciliation | 3 seconds | Two distinct effective tickers from server |
| Research admission | 5 seconds | Conversation ID accepted |

Email auth and operating-system sheet dwell are excluded from `journeyActiveMs`; human capture/search time remains inside it. Total elapsed and external wait remain visible in evidence. No animation auto-advances or blocks progress.

### System-Wide Impact

- **API:** push delivery assembly becomes per-recipient; Local Brief gains explicit readiness/sources/area identity; Research gains backward-compatible immediate admission; account deletion adds grant/status/delete schemas; OpenAPI and Postman regenerate from zod.
- **iOS app:** notification bootstrap, session hydration, router, map parameters, settings bundles, widget synchronization, account cleanup, and release scripts are affected.
- **Native extensions:** WidgetKit models, provider, list/map views, privacy manifest, version substitution, deep links, and signing assertions are affected.
- **Android:** the existing home-screen widget remains unchanged; parity redesign is deferred and does not block the iOS release.
- **Persistence:** versioned onboarding/consent state, atomic widget snapshots, pending/handled replay entries, deleted-subject tombstones, hashed deletion grants, and deletion-operation status are added. Server collections remain source truth.
- **Security/privacy:** bearer credentials remain out of shared containers and push data; Expo dispatch fails closed without push access security; AI traffic stays server-brokered; release credentials stay protected; deletion prevents stale JWT resurrection.
- **Operations:** main merges no longer auto-cut release candidates. An explicit validated manifest trigger creates the sole TestFlight build; a separate protected workflow handles current App Store review resources and exact-build recovery.
- **Agent parity:** widget/push targets may seed the Research screen with typed discovery context so the agent can explain “why this,” but it gains no permission or release tools.
- **Onboarding:** root/session orchestration, auth continuation, Map, Local Brief, Camera, find/watchlist reconciliation, Research admission, Settings restart, consent, analytics, and accessibility paths are affected.
- **Deletion/data lifecycle:** auth routes and every account-scoped store need a central deletion inventory; push claims are revoked first and client caches/App Group data are cleared afterward.

## Implementation Units

### U1 — Versioned release manifest and native identity guards

- **Requirements:** R9–R12; KTD4; F4; AE6.
- **Files:** `apps/ios/release/`, `apps/ios/.eas/workflows/testflight-production.yml`, `apps/ios/.eas/workflows/testflight-external.yml`, `apps/ios/scripts/testflight-production.ts`, `apps/ios/targets/widget/Info.plist`, `apps/ios/targets/widget/PrivacyInfo.xcprivacy`, `apps/ios/src/release/signingConfig.test.ts`, `apps/ios/src/release/testflightDistribution.test.ts`, `docs/DEPLOY.md`.
- **Approach:** Create one checked-in static release manifest for public copy, product-page story, reviewer walkthrough, version expectation, release mode, and an immutable content hash. Keep processed EAS/ASC IDs and evidence in a separate runtime release ledger bound to that hash. Make workflows load and validate the manifest, and change green-`main` iOS automation to require an explicit validated manifest/version trigger so intermediate concern-scoped merges do not cut obsolete TestFlight builds. Replace hard-coded widget version values with build-setting substitutions, and assert the app plus extension carry synchronized versions, required App Group entitlements, and privacy declarations.
- **Execution note:** Write characterization tests around current exact-TestFlight behavior before replacing literal copy.
- **Test scenarios:**
  - A valid manifest supplies identical What-to-Test and reviewer text to every TestFlight path.
  - Missing commit/version/evidence fields or copy that exceeds platform limits fails validation before build or submission.
  - App and widget extension versions resolve from build settings and remain synchronized as EAS increments the build number.
  - Archive inspection finds the intended App Group entitlement and required-reason privacy manifest and finds no provider key or bearer.
- **Verification:** Release-copy equality, signing assertions, and manifest validation pass; the exact tester message can be rendered without workflow-specific edits.
- **Dependencies:** None.

### U2 — Per-recipient push delivery contract and replay admission

- **Requirements:** R6–R8; KTD2–KTD3; F2–F3; AE2, AE4–AE5.
- **Files:** `apps/api/src/lib/push-dispatcher.ts`, `apps/api/src/lib/push-tokens-store.ts`, relevant notifier payload builders, `apps/api/tests/push.test.ts`, `apps/api/tests/push.postgres.test.ts`, `apps/api/tests/uncaught-nearby.test.ts`, `apps/ios/src/notif/`, `apps/ios/app/_layout.tsx`.
- **Approach:** Generate a unique delivery ID per recipient, include its opaque registered token ID, issuance/expiry, typed event target, and stable place/ticker context, and keep existing payload fields for compatibility. Extract a pure client admission policy that validates shape, expiry, current registration/account epoch, and a bounded replay ledger. Admit as `pending` before routing, promote to `handled` only after durable target handoff, and retry unexpired pending navigation on startup. Retain entries through delivery expiry plus clock skew; fail closed rather than evict an unexpired entry. Production dispatch requires Expo Push Security plus `EXPO_ACCESS_TOKEN`, fails closed when absent, and redacts tokens, installation/delivery IDs, and envelopes from logs.
- **Execution note:** Characterize current push preference, transfer, and sign-out semantics before changing delivery assembly.
- **Test scenarios:**
  - Two recipients of one event receive different delivery IDs and their own opaque token IDs while preserving the same informational payload.
  - A valid current-account delivery is pending before its navigation callback, handled only after durable handoff, and retried after termination without duplicate side effects.
  - Missing token ID, mismatched account epoch, expired delivery, malformed target, and repeated delivery ID are rejected without navigation.
  - Token transfer, sign-out, and account switch revoke or clear old context before a new account can admit it.
  - Older clients can ignore the additive fields without breaking delivery.
- **Verification:** Existing push suites stay green, new per-recipient and client-admission suites pass, and an old-client payload smoke test still parses.
- **Dependencies:** None; U1 and U2 may proceed independently and U7 aggregates their evidence.

### U3 — Notification value bundles, categories, and highlighted destinations

- **Requirements:** R5, R7–R8; KTD2; F2; AE4.
- **Files:** `apps/ios/app/(tabs)/settings.tsx`, `apps/ios/app/(tabs)/map.tsx`, `apps/ios/src/notif/prefs.ts`, `apps/ios/src/notif/router.ts`, `apps/ios/src/notif/lifecycle.ts`, new category/action helpers under `apps/ios/src/notif/`, and adjacent notification tests.
- **Approach:** Define Nearby Discovery as `uncaught_nearby`, `local_brief`, and `identify_done`; My Universe as `watchlist_mover` and `find_evolution`; and Research Ready as `memo_finished` and `agent_response`, while Daily Brief and user-created price alerts remain individual. Bundle rows support Off, On, Some on, Needs permission, Connecting, Retry, and Unavailable without overwriting unrelated keys. Register foreground navigation categories only after safe native bootstrap. Route `uncaught_nearby` to a typed Map target; Map waits for nearby data, centers, and highlights by stable place ID with ticker/coordinate fallback.
- **Test scenarios:**
  - No permission request occurs on first launch; enabling a bundle after explanation requests permission once and persists only after usable authorization and token registration.
  - Provisional permission is treated as usable, denied permission shows an Open Settings path, and offline token registration remains retryable.
  - Foreground, background, and cold-start default taps and View actions resolve the same typed target after session hydration.
  - A missing place or offline map shows a visible fallback and retains the target for retry.
  - Turning a bundle off performs one atomic preference patch and stops its event kinds without changing unrelated alerts.
  - Nearby Discovery fires only after demonstrated map/save interest, explains why the company is relevant, and respects the one-per-day/three-per-week ceiling.
  - VoiceOver announces row name/value/hint and connection errors; 200% Dynamic Type reflows; controls retain 44-point targets; focus restores after System Settings; Switch Control and keyboard paths remain operable.
- **Verification:** Router, lifecycle, permission capability, settings preference, and map-highlight tests pass; simulator deep links exercise every target.
- **Dependencies:** U2.

### U4 — Atomic Nearby Quest snapshot lifecycle

- **Requirements:** R1–R4; KTD1; F1, F3; AE1–AE3.
- **Files:** `apps/ios/src/widgets/widgetLocation.ts`, new snapshot/policy helpers under `apps/ios/src/widgets/`, Universe/quest synchronization hooks, auth/sign-out lifecycle, and widget policy/cleanup tests.
- **Approach:** Compose one display-ready snapshot after nearby, quest, dex, and find state settle. Include schema/snapshot IDs, guest or account scope, registration epoch, generated/expiry timestamps, ranked cards, relevance reason, caught status, one active quest, dex totals, and exact deep links. Write atomically with complete-file protection, keep a last-good entry, reload installed widgets, and fail closed on corrupt data or scope mismatch. State precedence is: scope mismatch/corrupt → clear personal content and setup; matching offline/expired last-good → labeled stale; denied location with matching last-good → stale plus Settings; denied without last-good → permission setup; fresh zero results → true empty. Sign-out/account switch clears personal, heartbeat, public/manual, and replay state before new activation.
- **Test scenarios:**
  - Never-opened, guest, signed-in, empty-nearby, corrupt, expired, and offline-with-last-good inputs select the intended honest state.
  - Caught filtering and quest/dex totals derive from one matching account epoch; mismatched scope clears rather than partially rendering.
  - A failed refresh preserves labeled last-good content only while its guest/account scope still matches.
  - Sign-out/account switch clears personalized data and triggers a widget reload before the next account becomes active.
  - Notification opt-out stops visit/heartbeat writes while a user-refreshed non-personal nearby snapshot remains usable.
- **Verification:** Pure snapshot-selection and lifecycle tests pass for the iOS adapter; serialized fixtures round-trip without secrets or precise display coordinates.
- **Dependencies:** U2 for shared account-transition ordering.

### U5 — Nearby Quest WidgetKit experience on iOS

- **Requirements:** R2–R4; KD1; F1; AE1–AE3.
- **Files:** `apps/ios/targets/widget/NearbyModels.swift`, `NearbyProvider.swift`, `NearbyListWidget.swift`, `NearbyMapWidget.swift`, `WidgetLocationStatusView.swift`, `ColorHex.swift`, iOS snapshot fixtures/tests, and `docs/SHARE_AND_WIDGETS.md`.
- **Approach:** Use Atlas Signal tokens and a discovery-dex visual hierarchy. Small focuses on one nearest target and its catch/explore state; medium adds quest progress and ranked nearby cards; large combines silhouette map, dex/sector progress, and a primary target. Every family uses large legible ticker/name hierarchy, honest freshness, accessible labels, and exact deep links. Do not render unsourced price movement or generic news.
- **Test scenarios:**
  - Each family renders guest, personalized, stale, empty, setup, and denied-location fixtures without clipping at supported Dynamic Type sizes.
  - Small has one hierarchy-level deep link; medium and large use valid per-card links without multiple conflicting widget URLs.
  - Light, dark, and tinted appearances keep readable contrast and do not encode caught status by color alone.
  - A card tap opens its exact company or highlighted Map target on iOS 16 and newer; unsupported interactive controls are absent.
  - Compound setup/stale/offline/permission states follow the U4 precedence table with one unambiguous title, support line, freshness label, and tap target.
- **Verification:** Snapshot/Swift previews or rendered fixtures cover every family and state; generated native projects compile on required CI images; screenshots become release-manifest evidence.
- **Dependencies:** U1 and U4.

### U6 — Current-resource App Store Review and release automation

- **Requirements:** R9–R12; KTD4; F4; AE6.
- **Files:** `.github/workflows/`, `apps/ios/scripts/`, `apps/ios/src/release/`, `apps/ios/package.json`, release-state fixtures/tests, and `docs/DEPLOY.md`.
- **Approach:** Replace any unsafe latest-build command with an exact-ID entry point. Add a protected workflow with minimal repository permissions, no PR/fork execution, a merged-`main` SHA allowlist, human environment approval, and a second storefront-release approval. After validation it retrieves a least-privileged App Store Connect key from Doppler, masks key/JWT material, and validates metadata, agreements, privacy/reviewer/subscription fields, reviewer walkthrough, and exact processed ASC build. It attaches and reads back that build, adopts or creates one current `READY_FOR_REVIEW` submission and item, records state in the runtime ledger, and can later release only the same approved version after the TestFlight evidence gate. Use current `reviewSubmissions` resources and short-lived JWTs.
- **Test scenarios:**
  - Dry-run resolves the expected app, version, and exact build and reports planned mutations without changing App Store Connect.
  - Two builds for one marketing version never cause implicit selection; a mismatch stops with all observed IDs.
  - Retry after an ambiguous attach/create/submit response inspects and adopts the existing relationship or draft without duplication.
  - An active conflicting submission, invalid build, missing metadata, incomplete privacy/review data, credential-role failure, 409/422, or rate limit stops with a resumable state.
  - Review rejection records the same version/build and requires an explicit newer-build decision; approved release uses only the recorded IDs and reports availability only after storefront confirmation.
  - Rejected, expired, or superseded builds require a new manifest version and ledger binding; automation preserves prior evidence and rejects IDs not bound to the active manifest.
- **Verification:** Fixture-backed state-machine tests cover every transition and recovery edge; a protected live dry-run proves credentials and metadata access before any submit mutation.
- **Dependencies:** U1.

### U7 — Release-candidate integration and exact-build evidence

- **Requirements:** R1–R18; F1–F6; AE1–AE15.
- **Files:** `IMPLEMENTATION_PLAN.md`, release manifest evidence fields, CI/EAS workflow artifacts, and release documentation.
- **Approach:** Land and merge the concern-scoped PRs in dependency order without release-candidate builds. The release-integration PR regenerates native projects cleanly, runs repository and targeted suites, compiles/archives on required images, inspects the archive, and records widget/notification/onboarding evidence. After merge, an explicit validated manifest trigger creates one exact TestFlight build. Confirm its manifest copy and external distribution, complete the real-device checklist, then pass those exact IDs into U6 for App Review and release.
- **Test scenarios:**
  - A clean release commit produces no generated-contract drift and no dirty archive inputs.
  - iOS native generation includes the widget target, App Group, deep-link schemes, notification entitlements, privacy manifests, and synchronized versions.
  - TestFlight covers signed-out/signed-in, account switch/sign-out, small/medium/large widget states, stale/offline refresh, permission authorized/provisional/denied, foreground/background/terminated taps, token rotation, duplicate response, and delivery failure.
  - Railway/API smoke proves additive push context, Local Brief readiness, and Research admission do not break deployed health, auth, public nearby, or an older client; a disposable authenticated account proves delete, idempotent status/retry, and stale-token rejection without touching the reviewer account.
  - The ASC build identity, changelog, manifest hash, and merged SHA agree before review submission.
- **Verification:** All automated gates are green; any physical-device-only step is recorded truthfully as passed or blocks App Review submission rather than being inferred from a build.
- **Dependencies:** U1–U6 and U8–U10.

### U8 — Resumable first-run journey and timing contract

- **Requirements:** R13–R16; KTD6–KTD7; F5; AE7–AE10.
- **Files:** replace `apps/ios/src/components/FirstOpenSheet.tsx`; add `apps/ios/src/onboarding/journeyState.ts`, `journeyStore.ts`, `FirstRunJourneyProvider.tsx`, `FirstRunJourneyOverlay.tsx`, and adjacent tests; update `apps/ios/app/_layout.tsx`, `apps/ios/app/index.tsx`, `apps/ios/app/auth.tsx`, `apps/ios/src/auth/saveContinuation.ts`, Home, and Settings.
- **Approach:** Use a pure versioned reducer with account scope, safe enum auth continuation, checkpoints, dismissal/completion timestamps, stable operation IDs, and active/wait timing. Mount after session readiness. Present a persistent, collapsible four-step mission card embedded in Map, Camera, and Research, with current context, one next-action control, consistent back behavior, and an always-visible Explore on my own action. Derive side-effect completion from the current account's server finds/watchlist rather than local flags. Home and Settings expose resume/restart; completion becomes a compact widget-preview card with deferrable setup guidance.
- **Execution note:** Characterize and migrate the existing `mapvest.firstOpen.v1` state before replacing it; a prior dismissal becomes dismissed, not falsely completed.
- **Test scenarios:**
  - New signed-out install starts a typed onboarding auth continuation and resumes the journey only after the same account becomes active.
  - Mature accounts with both qualifying Map-save and distinct sourced Camera-Find provenance begin at Brief/Research; accounts with one origin begin at the missing origin; two companies without qualifying provenance receive orientation without false completion.
  - Termination after every checkpoint resumes the next incomplete step without duplicating saves, Finds, brief generations, or Research messages.
  - Skip dismisses but does not complete; Home/Settings restart the next incomplete step.
  - Account switch, sign-out, auth expiry, and cleanup-required state prevent another account's progress or operation IDs from being reused.
  - Active time and external wait time are recorded separately; no timeout falsely marks completion.
- **Verification:** Reducer/store/migration/auth-continuation integration tests pass, and every state has a reachable retry, skip, or ordinary-app exit.
- **Dependencies:** U2 for account-transition ordering.

### U9 — Live Map, Brief, Camera, collection, and Research quickstart

- **Requirements:** R13–R17; KTD6–KTD8; F5; AE7–AE10.
- **Files:** canonical Local Brief and Research admission schemas under `packages/core/src/schemas`, `apps/api/src/routes/localBrief.ts`, `apps/api/src/routes/agent.ts`, `apps/api/src/lib/research-agent.ts`, API contract tests/generated OpenAPI/Postman, `apps/ios/app/(tabs)/map.tsx`, `apps/ios/src/components/LocalEconomyBriefCard.tsx` plus a reusable brief hook/compact presentation, `apps/ios/app/(tabs)/camera.tsx`, `apps/ios/src/nav/chatAbout.ts`, `apps/ios/app/(tabs)/research.tsx`, find/watchlist query helpers, AI-consent components/store, privacy copy/docs, and journey integration tests.
- **Approach:** First characterize production nearby responses for dense, sparse, empty, selected-region, stale, latency, and error cases; reopen the route decision if fields or timing fail consumers. Race nearby and a controlled Local Brief from the real or explicitly selected map region. The canonical Brief response carries `status: ready | degraded`, `sources: Source[]`, and stable requested-area identity across fresh/cache/outage paths. Let the user pick and explicitly save one nearby investable. Explain Camera/Photo Find behavior, request access contextually, and accept only a sourced investable/comparable. Reconcile two distinct effective tickers from server finds/watchlist. Add backward-compatible Research `responseMode: completed | accepted`; `accepted` durably admits and returns HTTP 202 with conversation/client-message IDs while existing completion mode remains default. Build an editable Research seed without raw photo or precise coordinates.
- **Test scenarios:**
  - Granted, denied, reduced-accuracy, cannot-ask-again, and selected-map-area location paths show honest labels and never request background location.
  - Camera allow, deny, Settings recovery, library fallback, ambiguous/private item, missing sources, quota, offline queue, and provider failure remain incomplete and retryable.
  - Only a real Map investable with confirmed watchlist save and a sourced Camera Find can satisfy collection; duplicate effective ticker remains one of two and offers another nearby selection.
  - Warm/cold Local Brief renders before completion; `degraded`, missing-source, loading, or stale/mismatched-area responses do not count.
  - Camera and Research each show named just-in-time AI-sharing disclosure before first transfer; decline leaves map/save/skip usable and performs no transfer.
  - Research draft is editable and never auto-sent; retry reuses its client message ID, and only one accepted conversation ID advances completion.
  - VoiceOver order, 200% text, 44-point targets, contrast, Reduce Motion, small screen, and no timed auto-advance cover the common journey.
- **Verification:** Pre-merge tests prove reducer/instrumentation correctness, Brief readiness, and immediate admission. Post-merge TestFlight evidence under U7 proves the under-60-second median and p90 across the declared sample; every degraded branch remains truthful, resumable, and non-blocking.
- **Dependencies:** U8 and existing nearby/identify/watchlist routes; Local Brief and Research receive additive contract behavior rather than new feature endpoints.

### U10 — In-app account deletion and complete data cleanup

- **Requirements:** R18; KTD9; F6; AE11.
- **Files:** authenticated delete-account route and zod schema under `packages/core`/`apps/api`, central account-data deletion service and store adapters, push/auth tests, `apps/ios/app/(tabs)/settings.tsx`, session cleanup controller/store, OpenAPI/Postman generation, `docs/ARCHITECTURE.md`, `docs/SECRETS.md` or privacy documentation, and release metadata checklist.
- **Approach:** Inventory every Postgres/in-memory owner-key store plus logs, backups, Research Console, AI processors, Stripe/Apple, Expo, and object storage in a lifecycle matrix with owner key, deletion method, retention/legal exception, redaction, and evidence. Recent magic-code reauth mints a short-lived single-use deletion grant bound to user, operation ID, request digest, and nonce; persist only its hash. Before the destructive call, write a deletion-pending App Group marker and reload widgets to non-personal content. Persist the deleted-subject tombstone and operation state before row cleanup so bearer/optional auth reject old subjects before `ensureUser`; retry/status uses the same deletion grant, not the revoked bearer. The client shows summary, inline typed confirmation, deleting, ambiguous-status inspection, retryable cleanup, non-retryable support, local-resume, and terminal guest states. Unknown or partial cleanup remains fail-closed.
- **Execution note:** Add data-integrity characterization tests before the destructive service and verify the inventory against every `user_id`/owner-key store.
- **Test scenarios:**
  - Canceling either confirmation step performs no server or local mutation.
  - A confirmed request deletes finds, progress/XP, watchlists/memos, research references, saved briefs, alerts, rivalries, billing/entitlement links where locally owned, push claims/deliveries, and the user while preserving shared market caches.
  - Retry with the same operation ID after an ambiguous response returns the same deleted result without recreating or failing on absent rows.
  - Push revocation or required-store failure stops before user authority is reported deleted; the response identifies a retryable cleanup state without leaking data.
  - Server success followed by client interruption resumes local cleanup before another sign-in, and the deleted token cannot authenticate or receive pushes.
  - The widget renders non-personal content from deletion start through local cleanup, and an old subject cannot be recreated through bearer, optional auth, or magic-link lookup.
  - VoiceOver announces confirmation errors, progress, retry, and completion; 200% Dynamic Type reflows; controls retain 44-point targets; cancellation is possible only before the destructive request starts.
  - OpenAPI/Postman and privacy/account-deletion documentation match the live contract.
- **Verification:** Memory and Postgres integration suites prove the complete deletion inventory, auth invalidation, idempotency, and unrelated shared-data preservation; Settings accessibility and destructive-confirmation tests pass.
- **Dependencies:** U2 for push ownership cleanup, U4 for the shared widget/App Group clearing helper, and U8 for onboarding/local state cleanup.

### Concern-scoped delivery sequence

1. **Release controls PR:** U1 and U6 disable implicit candidate builds, establish the static manifest/runtime ledger, and add protected exact-ID dry-run automation.
2. **Push and notification safety PR:** U2 and U3 add recipient admission, fail-closed Expo security, value bundles, cadence, and highlighted routing.
3. **Widget PR:** U4 and U5 add the atomic iOS snapshot and WidgetKit Nearby Quest presentation.
4. **Quickstart and AI consent PR:** U8 and U9 add guest value preview, resumable mission card, additive Brief/Research proofs, Camera/photo collection, and versioned AI consent.
5. **Account deletion PR:** U10 adds recent reauth, deletion grants, tombstones, complete lifecycle cleanup, and client recovery UI.
6. **Release integration PR:** U7 binds all merged concerns to one manifest hash and exact SHA, runs the full release gates, and enables the sole explicit TestFlight trigger.

Each PR must independently pass lint, type checks, targeted/full tests as applicable, review, and merge. No intermediate merge may trigger a release-candidate build.

## Verification Contract

### Pre-merge CI gates

- Root dependency install is locked and clean; Biome lint/format, TypeScript checks, and the full Bun test suite pass.
- Targeted API push, Postgres ownership, uncaught-nearby, iOS notification lifecycle/router/permission/sign-out, widget policy/parity, release manifest, signing, and App Store state-machine suites pass.
- First-run reducer/store/migration, auth continuation, Map/Brief/Camera/collection/Research integration, AI-consent, and account-deletion memory/Postgres suites pass.
- Generated OpenAPI and Postman artifacts remain unchanged unless a source zod schema legitimately changes; any change is regenerated rather than hand-edited.
- Expo Doctor and clean native generation succeed; the authoritative iOS archive uses Xcode 26 or newer.
- The signed iOS archive contains the app and widget extension with matching version/build, intended App Group access, notification capability, privacy manifests, and no secret material.
- Instrumentation tests prove the start/stop/pause boundaries and exclude no healthy completed run after collection begins.

### Post-merge exact-build gates

- The deployed API smoke passes before the TestFlight binary relies on additive Brief, Research, push, or deletion behavior.
- The protected App Store workflow passes a no-mutation live dry-run against the exact processed build before submit mode is enabled.
- Twenty fresh-account TestFlight runs cover two supported physical-device classes, balanced warm/cold service state, and stable Wi-Fi plus LTE/5G. Predeclared exclusions are limited to unavailable external auth/provider service or unhealthy network before the timed segment. Report median and p90; median above 60 active seconds blocks App Review without a user-approved ledger waiver.
- Widget installation, remote push delivery, and the complete reviewer walkthrough pass on the exact build; device-only failures block submission rather than being inferred from compilation.

### Experience Evidence

- Widget evidence covers all supported sizes in guest, personalized, stale, offline, empty/setup, dark, light, tinted, Dynamic Type, and VoiceOver states.
- Notification evidence covers post-value opt-in, authorized/provisional/denied permissions, token retry/rotation, foreground/background/terminated taps, every category action, account switch, replay rejection, and missing/offline target fallback.
- Map evidence shows an uncaught-nearby push opening and highlighting the intended place after hydration, with a visible fallback when the place cannot be resolved.
- Release evidence links the merged SHA, release-manifest hash, EAS run/build UUID, ASC build ID, version/build, TestFlight distribution, screenshots, and checklist result.
- Onboarding evidence covers signed-out auth continuation, existing/mature account, skip/restart, every permission branch, Local Brief ready/degraded, distinct/duplicate companies, AI consent allow/decline, termination at every checkpoint, Research accepted/retry, VoiceOver, large text, and Reduce Motion.
- Account-deletion evidence proves explicit confirmation, complete account-data inventory deletion, token/push invalidation, local cleanup resume, and shared-market-data preservation.

### Operational Gates

- CI and review must be green before merge; unresolved P0/P1 findings block merge.
- The deployed API smoke test precedes reliance on each additive contract; each concern lands in its own reviewed PR before the explicit release trigger.
- App Review submission stops on any incomplete Apple metadata, agreement, privacy, screenshot, reviewer credential, subscription, or role gate and reports the exact missing item.
- App Review submission also stops unless in-app account deletion is live, camera/Research AI consent matches the published privacy answers, and Review has a working demo account or complete demo path.
- A successful upload, TestFlight distribution, Beta Review submission, App Review submission, approval, release, and storefront availability are reported as distinct states.
- Retries use recorded IDs and inspect before mutation. No path uses `--latest`, a newest-build query without exact identity filters, or blind review-submission creation.

## Risks and Dependencies

- **Physical-device evidence:** widget installation and remote notification delivery cannot be fully proven by unit tests or a local simulator. Mitigation: require the exact TestFlight build checklist and do not call it passed from compilation alone.
- **Apple account readiness:** agreements, privacy nutrition labels, reviewer credentials, screenshots, subscription review information, or API roles may be incomplete. Mitigation: live dry-run reports these before submission and leaves a resumable exact-build record.
- **Native toolchain drift:** the local host is older than Apple's current upload requirement. Mitigation: treat Xcode 26 EAS/GitHub evidence as authoritative and keep local checks supplemental.
- **Widget freshness:** WidgetKit refresh is budgeted and location access is brief. Mitigation: app-authored last-good snapshots, explicit timestamps, stale labels, and open-app refresh paths.
- **Push at-least-once delivery:** duplicate, delayed, or interrupted responses are expected. Mitigation: unique delivery IDs, account/installation admission, pending-to-handled handoff, startup retry, and replay retention through expiry plus clock skew.
- **No binary rollback:** once public, rollback means stopping a phased release or shipping a newer build. Mitigation: retain the final exact-build release gate and truthful state tracking.
- **One-minute variance:** auth email, human permission decisions, capture time, and model latency can exceed a minute. Mitigation: measure controllable active time separately, prefetch Brief/Nearby in parallel, count Research admission rather than terminal memo, and market the flow as “about a minute,” not a guarantee.
- **Destructive deletion inventory:** lazy stores or third-party retention can escape a partial user-row cascade. Mitigation: maintain one tested first-/third-party lifecycle matrix, tombstone authority before cleanup, disclose legal/retention exceptions, and fail closed on incomplete controllable deletion.
- **AI sharing disclosure:** camera, location context, and Research prompts cross third-party AI boundaries. Mitigation: named just-in-time consent, data minimization, a decline path, privacy-policy/App Privacy alignment, and no raw image/precise location in Research seeds.

## Documentation and Release Copy

### TestFlight “What to Test”

```text
Mapvest beta — live first run, Nearby Quest widgets, and safer alerts

Please test on a real device:
• On a fresh install, start the quickstart. Confirm you see one real nearby company before sign-in. After sign-in, save a map company, identify a different company with Camera or a photo, see a sourced Local Brief, and send the editable two-company Research prompt in about a minute of active time.
• Kill and reopen during every step. The mission card should resume without duplicating either company. Explore on my own must remain available, and notification permission must not appear.
• Deny location or Camera once. Confirm Map offers a selected-area path, Camera offers photo-library/Settings recovery, and no step is falsely completed.
• Add the Mapvest Nearby Quest widget, resize it, and confirm it shows an honest setup, stale, permission, empty, guest, or nearby state.
• Move to a new area, reopen Mapvest, and confirm the widget refreshes.
• Save the highlighted nearby company and confirm quest/universe progress updates.
• Enable Research Ready or Nearby Discovery in Settings; Mapvest must not ask on first launch.
• Tap an uncaught-nearby alert and confirm Map opens on the highlighted company.
• Sign out or switch accounts and confirm old widget data and notification taps never carry over.
• From Settings, use a disposable account to test permanent account deletion; an old session must not sign back in.

Finance information is sourced research, not advice.
Feedback: jawaun@generalintelligencecompany.com
```

### App Store “What’s New”

```text
Explore the companies around you with the new Nearby Quest widgets. See a nearby company, track your Universe progress, and jump straight into the map from your Home Screen.

New here? A delightful live quickstart gets you from the map to your first Local Brief, Camera find, two-company Universe, and Research question in about a minute.

Notifications are smarter and fully opt-in: choose the updates you want, then open nearby discoveries in the exact place on the map. This release also improves sign-in continuity, account deletion, stale/offline states, and account privacy across onboarding, widgets, and alerts.
```

### Beta/App Review Positioning

Mapvest helps people discover publicly traded companies and sourced public comparables for private brands through a map, camera, and research experience. It provides informational market research and does not execute trades, connect to brokerage accounts in this release, manage portfolios, or provide personalized investment advice. Review notes must describe the live quickstart, permission fallbacks, AI-sharing consent, account deletion, sign-in, one notification category, widget setup, nearby refresh, and highlighted nearby alert; credentials remain in protected release secrets, never the repository.

The release manifest blocks submission until it contains a reproducible reviewer walkthrough: exact sign-in entry and secure demo-account delivery, one stable sample map area, one stable camera/photo subject, expected permission and AI-consent screens, widget installation steps, a deterministic notification trigger and expected delay, highlighted-map outcome, deletion steps for a separate disposable account, fallback instructions, and support contact. The public product-page package must also include:

- **Subtitle theme:** Discover the companies around you.
- **Description/keyword theme:** map stocks, scan brands, sourced ticker or public comparable, save a Universe, and deepen with optional Research.
- **Screenshot story:** nearby place → camera object → sourced ticker/comparable → two-company Universe → Local Brief/Research → opt-in widget and alerts.

## Sources and References

- Existing implementation: `apps/api/src/routes/widget.ts`, `apps/api/src/lib/push-dispatcher.ts`, `apps/api/src/lib/push-tokens-store.ts`, `apps/ios/src/widgets/`, `apps/ios/targets/widget/`, `apps/ios/src/notif/`, `apps/ios/.eas/workflows/`, `.github/workflows/ios-eas-production.yml`.
- Project contracts: `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `docs/SHARE_AND_WIDGETS.md`, `docs/UNIVERSE_ROADMAP.md`, `docs/DEPLOY.md`, `docs/SECRETS.md`.
- Apple: [Submitting to the App Store](https://developer.apple.com/app-store/submitting/), [Widget design](https://developer.apple.com/design/human-interface-guidelines/widgets/), [Widget timelines](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date), [Widget location](https://developer.apple.com/documentation/widgetkit/accessing-location-information-in-widgets), [Notification permission](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications), [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [current review submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions).
- Apple onboarding/privacy: [Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding), [Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy), [Account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [App Privacy details](https://developer.apple.com/app-store/app-privacy-details/), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility).
- Expo: [SDK 54 notifications](https://docs.expo.dev/versions/v54.0.0/sdk/notifications/), [EAS build infrastructure](https://docs.expo.dev/build-reference/infrastructure/), [TestFlight submission](https://docs.expo.dev/submit/testflight/), [push delivery and receipts](https://docs.expo.dev/push-notifications/sending-notifications/).

## Definition of Done

- [ ] R1–R18 are implemented without a bearer, provider key, raw photo, or user email entering widget shared storage or push payloads.
- [ ] U1–U10 verification outcomes and AE1–AE15 pass, with physical-device-only results recorded as evidence rather than inferred.
- [ ] Lint, type checks, full/targeted tests, native generation, Xcode 26 archive, entitlement/privacy inspection, and App Store dry-run are green.
- [ ] TestFlight and App Store copy are generated from the validated release manifest and match the shipped Nearby Quest/notification behavior.
- [ ] The quickstart reaches a ready Local Brief, two distinct server-confirmed companies, and one accepted user-sent Research message within the defined healthy-path SLO; skip, resume, denial, duplicate, degraded, and AI-consent-decline paths remain usable.
- [ ] In-app account deletion and all server/device cleanup tests pass, and App Privacy/review notes match actual AI data transfers.
- [ ] Release infrastructure, push/notification safety, widget, quickstart/AI consent, and deletion land as separate reviewed CI-green PRs; the release-integration PR records their exact merged SHA and manifest hash.
- [ ] The exact merged TestFlight build is processed and distributed; its available device evidence checklist is complete.
- [ ] The exact ASC build is attached to the intended version and submitted through one current review submission, or automation stops with the precise external gate.
- [ ] If Apple approves and the evidence gate remains green, the authorized exact version is released and storefront availability is confirmed; no earlier state is described as “released.”
- [ ] `IMPLEMENTATION_PLAN.md`, widget/notification/release docs, and generated contracts accurately reflect the shipped state.

### Bro

This release gives new users a live one-minute path through the map, Local Brief, Camera, two real companies, and Research. It also turns the widget into a nearby-company quest, keeps notifications and account deletion private, and ties every App Store step to one exact build; if Apple setup or real-device proof is missing, it stops and says exactly what is left.
