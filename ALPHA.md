# ALPHA.md — Patterns to borrow from the-human-internet-{app,backend,website}

Extraction run on 2026-10-05 from Jawaun's three sibling repos (private, GitHub):

- [the-human-internet](https://github.com/jawauntb/the-human-internet) — Next.js website
- [the-human-internet-app](https://github.com/jawauntb/the-human-internet-app) — SwiftUI iOS
- [the-human-internet-backend](https://github.com/jawauntb/the-human-internet-backend) — Rust Lambda + Supabase Edge Functions Each repo's `CLAUDE.md` is the authoritative source. Items are ordered by expected ROI for *this* repo — Mapvest, the "world as watchlist" product (Bun monorepo, iOS app at `apps/ios`, OpenAPI spec at the root, finance-agent / analytics / find pipeline).

**Default behavior for a coding agent reading this**: implement every section. One PR per section, each on its own `git worktree` branched from `main` — see `AGENTS.md` → ALPHA.md for the exact flow. Only skip a section with a written reason inside a strike-through.

Mapvest's shape is unusually close to the trio's: a camera-based identify-and-save pipeline, a server-authoritative resolution step (brand → ticker, with sources), a per-user accumulating universe of "finds", and a shareable public artefact. Several of the trio's patterns transfer almost verbatim — especially §1 (the durable optimistic queue) and §2 (attestation gating on the identify endpoint).

---

## 1. On-disk optimistic queue with resume on launch, bounded by both age and count

Capture → write bytes to `Application Support/Pending/` + append to a JSON manifest → return a provisional object to the UI → do everything expensive (brand recognition, ticker resolution, sources, server coordination) in the background. The manifest on disk is the source of truth; `AppState.processingIDs` / `failedIDs` are just its in-memory reflection. On cold launch, a single `hydrate(userID:)` call resumes the queue; a 10s banner timer re-kicks as belt-and-suspenders. Pending entries expire (your own: 30d, foreign: 7d) and the manifest caps at 200 entries — so a permanently-failing find never sits on disk forever and a shared device never leaks another user's pending identifies.

Concurrency is **capped at 2** signing/upload operations because each holds a full-res bitmap in memory and uncapped rapid taps got the app jetsammed. The shutter deliberately does *not* serialize.

Where it fits here: this is **exactly** the find pipeline. `apps/ios/src/` likely has (or will have) a capture tap → identify → resolve → persist flow. A find should land in the user's grid *instantly*, provisionally, with the ticker-resolution happening afterwards. Delete-while-pending must cancel the enqueued work (`cancelPendingUpload` in the trio) — otherwise a resumed job resurrects a deleted find.

Source: `the-human-internet-app/CLAUDE.md` → "Upload pipeline" (`PhotoUploadQueue`).

## 2. Attestation-gated writes: soft-launch, then flag-flip to hard

Apple App Attest (iOS Secure Enclave) proves "this request came from this app on real Apple hardware." The trio uses it to gate C2PA signing: every signing request carries an assertion over the exact bytes being signed. It never blocks by itself — the simulator, Apple being unreachable, or an unregistered install all just send unattested, and the **server** decides based on the `require_app_attest` flag. Ship it logging-only first, flip the flag `admin` to test, then `all`.

Where it fits here: **the identify endpoint.** Mapvest's whole value is "I saw this brand with my own eyes" — an un-attested identify could be a scraper calling the API from a datacenter. Attach an App Attest assertion over the identify request body (image hash + geo + timestamp). The attestation proves the request's origin, not the pixels — a jailbroken device can still hook capture — but it closes the drive-by-API attack surface. Edits beyond the signed capture (e.g., image preprocessing on-device) are the follow-on work, same as in the trio.

Non-obvious implementation note from the trio: the Supabase Edge runtime (Deno) throws `NotSupportedError: Not implemented` from `crypto.subtle.verify` for ECDSA over P-384 with SHA-256 — exactly how Apple's App Attest CA signs every credential certificate. Use `@noble/curves` for both the chain and the assertion, and keep a test that stubs `crypto.subtle.verify` to throw and requires the verifier to still pass. Also, the assertion counter is recorded but **not required to increase** — because the clientData is content-bound (the image itself), a replay only re-signs bytes its holder already had, and concurrent writes arrive out of counter order.

Source: `the-human-internet-backend/CLAUDE.md` → "App Attest gates it" and `_shared/appAttest.ts`; `the-human-internet-app/CLAUDE.md` → "Signing requests are App Attest-gated".

## 3. Three-way remote feature flags: `off` / `admin` / `all` with per-flag fallback

A single `feature_flags` Postgres table with `audience text check (…)` and a client resolver that reads the caller's `is_admin`. `admin` is the dark-launch audience — exercise against real production state before everyone sees it. Each flag declares *its own* fallback audience (not a global default), because the safe direction depends on what the flag guards: a licensing / cost flag falls back `off`, a required-step flag could fall back `all`.

Where it fits here: the four product layers (Identify, Research, Finance Agent, Analytics) each have features that are expensive, experimental, or compliance-gated. A model-swap on the agent, a new chart type in Analytics, a paid-only tier on Research — all want admin-first dark launch. Current flags in the trio to study: `server_side_watermark`, `require_app_attest`, `stripe_identity_test_mode`, `custom_verification_pages`, `neue_font`.

Source: `the-human-internet-app/CLAUDE.md` → "Admin role, developer menu, and feature flags".

## 4. Server-side flag resolution is the *only* binding gate

The client reads a flag to decide what to *ask for*. The server re-reads the same flag against the caller's `is_admin` and decides what to *answer*. A kill switch two independently-deployed clients must honour is two switches, not one. In the trio: the Stripe test-env toggle is checked in three places in UI code and *the only one that binds* is `stripe-identity-session` re-reading the flag server-side when it picks which Stripe key to use.

Where it fits here: pricing tiers, agent model selection, API gate-keeping. If the finance agent should use `gpt-4o` for admins and `gpt-4o-mini` for everyone else behind a flag, the gate lives in the server handler that calls OpenAI — not in the iOS switch that *displays* a different label.

Source: `the-human-internet-backend/CLAUDE.md` → `stripe-identity-session` (admin-only AND flag resolved server-side); `the-human-internet/CLAUDE.md` → "That flag is not read here, on purpose".

## 5. The three-places-must-match pattern with pinning tests

Any cross-system contract — a SQL CHECK ↔ Swift/TS enum ↔ server lookup — needs a test that pins each half against the others, because nothing in the compiler catches drift. The trio's `SOCIAL_PLATFORMS` and `digitalSourceType=camelCase` live in multiple files; each is pinned.

Where it fits here: **the OpenAPI spec IS this contract.** `openapi.yaml` at the repo root is the server contract; `apps/ios/` consumes it; `packages/core/tests/mcp-schemas.test.ts` already exists and looks like exactly the right place to pin the schemas on both sides. Check that:
- Every ticker-resolution label (public / private / ETF proxy) has one source of truth.
- Every "find source" tag the server emits is a known case on the client and the archive renderer.
- Every subscription tier string the server returns is declared in both iOS and the agent planner.

Source: `the-human-internet-app/CLAUDE.md` → "The platform whitelist lives in three places"; `the-human-internet-backend/CLAUDE.md` → `digitalSourceType` camelCase.

## 6. Decoding fallbacks: unknown value → claim *less*, never more

Any enum crossing a JSON boundary (DB → client, server → client, OpenAPI → MCP → agent) decodes an unknown value to a declared fallback, and the fallback is chosen to claim less about the subject. In the trio: an unreadable `verification_status` decodes to `unverified`, never `verified`. A missing feature-flag row resolves `off`.

Where it fits here: a resolved ticker's confidence tier, a find's source-provenance tag, an agent-brief's quality grade. If any of these can be absent or future-added, the client must render the weakest claim, not the strongest. An "unknown resolution confidence" renders as low, never high.

Source: `the-human-internet-app/CLAUDE.md` → `HumanUserDecodingTests` and the `unverified` incident.

## 7. Trigger-guarded columns: BEFORE UPDATE revert + BEFORE INSERT force-default

RLS lets a user write their own full row, so any column that must not be user-writable (`is_admin`, `is_verified`, `resolved_ticker`, `server_signed_at`) needs **both** a BEFORE UPDATE trigger that reverts the change *and* a BEFORE INSERT trigger that forces the safe default. The UPDATE guard alone leaks: a brand-new user has no row yet and the INSERT policy lets them create one with any value. Both exempt `service_role` and NULL `auth.role()` (so dashboard SQL still works).

Where it fits here: if a find's `resolved_ticker`, `resolution_confidence`, or any "this was validated by the real pipeline" column lives in Postgres and the client has normal row-write access, apply this. The client *showing* "resolved to AAPL" when the server never resolved it is a product-defining bug.

Source: `the-human-internet-app/CLAUDE.md` → "`verification_status` is write-protected" and the parallel `is_admin` section.

## 8. Share pipeline split by what each platform *actually accepts*

The trio does not have one share button; it has five destinations each routed differently:
- **Reddit / X** → their own compose intents, link-only (no image), because these platforms re-encode on upload and strip any provenance manifest. The link renders an Open Graph card.
- **Messages** → in-app `MFMessageComposeViewController` with the link pre-filled as body text — the one destination that accepts caption text from a third-party app.
- **Instagram / Facebook** → copy the link, show an instructions sheet, then present `UIActivityViewController` with just the image, because these refuse third-party caption text by policy. The image is handed over as a **temp file URL, not a `UIImage`**, because share extensions run memory-constrained and crashed on full-res in-memory images.

One file (`Sharing/ShareIntent.swift`) owns every URL shape; one test (`ShareIntentTests`) pins every form including the strict percent-encoding of the nested link.

Where it fits here: when a find or a brief is shareable (and finance screenshots are *extremely* shareable), decide the per-platform mechanism *before* shipping one generic share sheet. For X in particular: `x.com/intent/post` answers an iPhone user agent with a `x-safari-https://` redirect that forces the URL out to Safari — so try `twitter://post?message=` first, fall back to the web composer. Reddit has no documented compose deep link; use the `reddit.com/submit` universal link.

Source: `the-human-internet-app/CLAUDE.md` → "Sharing" section and `ShareIntent.swift`.

## 9. Public URLs are a public API; one function serves both id generations

The-human-internet's `/[photoId]` route accepts both an 8-char Base58 short code *and* a legacy UUID through one RPC (`get_verification_photo(p_lookup text)`). The RPC takes `text`, regex-guards the UUID path (so a bare `::uuid` cast doesn't throw on short codes), and tests on both app and website pin the exact shape. Changing the alphabet (Bitcoin Base58, no `0/O/I/l`), length, or signature breaks every link ever shared.

Short codes are generated **client-side** at enqueue time (`VerifiedPhoto.generateShortCode()`), so they stay stable across retries of the same upload; the DB default is only a safety net. Base58 at 8 chars gives ~1.3×10^14 values, so no client-side collision retry — a unique index + CHECK regex backstop it.

Where it fits here: find URLs, brief URLs, saved-chat URLs, memo URLs. All four are the kind of thing that gets DM'd between users or posted into X. Decide the shape *now*.

Source: `the-human-internet/CLAUDE.md` → "`/[photoId]` is a public API"; `the-human-internet-app/CLAUDE.md` → `VerifiedPhoto.generateShortCode()`.

## 10. iOS shake-to-reveal dev menu, gated on `is_admin`

A gesture bridge mounted in the root view, gated on `appState.isAdmin`. Three pages: **per-device** on/off switches via `UserDefaults` (so one admin's testing doesn't affect another's device), remote feature flags (what every user gets), and flow triggers (manually re-run flows that normally only fire once mid-onboarding). The per-device preference ANDs in `isAdmin` on read so a non-admin signing in on the same phone never inherits it.

Where it fits here: `apps/ios/` almost certainly already has a dev menu or needs one. Candidate switches: "mock identify with sample image", "force low-confidence resolution", "replay last brief", "switch to local Supabase", "use sandbox finance API", "stress-test queue with 50 fake finds".

Source: `the-human-internet-app/CLAUDE.md` → "Admin role, developer menu, and feature flags".

## 11. Security-definer RPCs instead of blanket anon-readable table policies

Rather than making a table anon-readable (which lets anyone *enumerate* every row), expose a `security definer` function granted to `anon` that only ever answers about *one* row whose code the caller already holds. The function withholds non-public fields based on owner state and feature flags, all resolved server-side.

Where it fits here: the public web face of a shared find or brief. If the universe of finds is viewable at all without auth (and a shared link to a brief implies yes), use a lookup-by-shortcode RPC that only answers for one record and only returns public fields.

Known traps when debugging anon access: (a) **RLS does not bypass RLS** — an `anon` policy that queries another table via `EXISTS` returns zero rows if `anon` can't read that other table. Use a `security definer` helper. (b) **`storage.buckets` has its own RLS** with no `anon` policy by default — `createSignedUrl` fails with a misleading `Object not found` before the object-level check runs. (c) Test *as* the role: `set local role anon; select …` — a policy that exists is not a policy that passes.

Source: `the-human-internet/CLAUDE.md` → "Anonymous access is narrower than it looks".

## 12. Server-side composition for anything that *claims* something

If a user can type a claim, the claim means nothing. The trio composes the identity sentence server-side from trigger-guarded columns written only by Stripe's webhook, gated on three independent conditions.

Where it fits here: the "resolved to ticker X, with sources" claim on a find — and especially the brief/memo on a company. If any part of the "sources, always" promise is composed on the client from un-trusted content, it's game-over: a user with inspector access can edit the DOM to attach any brand to any ticker. Compose the "{brand} resolved to {ticker} on {date} via {source}" string server-side from server-written columns; let the client control *whether* to show it and *how* to lay it out, never *what it says*.

Source: `the-human-internet/CLAUDE.md` → the whole page-customization section; `the-human-internet-app/CLAUDE.md` → "Both verification pages state it as a sentence".

## 13. Deletes: DB row first, storage object second

The row is what public read paths read. Deleting the row *first* is what actually kills the public surface. The storage cleanup is best-effort; a failed object delete leaves an orphan — strictly better than a dangling live surface pointing at nothing. Don't reverse the order.

Where it fits here: deleting a find, retracting a shared brief, batch-removing a chat history.

Source: `the-human-internet-app/CLAUDE.md` → "Deletes go DB row first, Storage object second".

## 14. Image/thumbnail cache opts in via a flag, not always-on

The trio's `RemotePhotoImage(isThumbnail:)` opts into a shared downsampled cache (600px cap) — grid cells need it because a `LazyVGrid` destroys and recreates view identity on scroll, so without it re-scrolling a 50-photo grid re-downloaded and re-decoded everything at full resolution. Full-resolution contexts (detail, verification page) deliberately don't participate: they're single long-lived views with nothing to cache, and they need the real pixels. The cache is keyed by storage path alone — so a provisional / in-flight asset must not enter it (it would outlive the final asset at that key).

Where it fits here: the universe grid in the iOS app — a growing list of finds the user scrolls through — is the exact failure mode. If it ever renders a `UIImage(contentsOfFile:)` or `AsyncImage` without a downsampled thumbnail path, that's the fix.

Source: `the-human-internet-app/CLAUDE.md` → `RemotePhotoImage`.

## 15. Deep-link return URLs for a WebView wrapper must be `https`, not a custom scheme

Stripe (and most payment / verification platforms) reject a custom-scheme `return_url` with `url_invalid`, which 400s session creation. Use an `https://…` URL that the WKWebView wrapper recognises via a `HostPolicy.isReturnURL(url)` check and *cancels before load* — so nothing needs to exist at that path. Mirror the constant in the server function; drift is silent (the web view simply never dismisses). Pin the app's half with a test.

Where it fits here: brokerage account connections, Stripe/Plaid flows, OAuth to a data provider — anywhere the finance product has to open a web view for an external KYC/connect step.

Source: `the-human-internet-app/CLAUDE.md` → "Stripe Identity" section, `StripeIdentityHostPolicyTests`.

## 16. CI secrets must never run on `pull_request` (above all `pull_request_target`)

A public repo whose deploy job holds signing / Supabase / provider secrets must not expose them to arbitrary PR branch code. PR-time CI (tests, lint, type-check) belongs in a *separate*, secret-free workflow. If this repo turns public (or already is), enforce the split now.

Also useful: `git push` to an `https://` origin without credential helpers fails with `could not read Username for 'https://github.com': Device not configured`. Push via the SSH form when `gh` is already SSH-authenticated.

Source: `the-human-internet-app/CLAUDE.md` → "Shipping (TestFlight)" four-point rule and the "Push over SSH" dev note.

---

## Non-obvious infrastructure notes worth keeping within reach

- **UUIDs: Swift uppercases, Postgres lowercases.** An RLS policy that compares `storage.objects.name` to `auth.uid()::text` as *text* silently rejects every upload. Cast to `uuid` for a type-correct comparison, and lowercase defensively on the client. (`the-human-internet-app/CLAUDE.md` → "Storage bucket `photos`".)
- **One `hydrate(userID:)` method as the source of truth for sign-in.** Both cold-launch and fresh sign-in call it. The trio used to have two copies that drifted — only one fetched photos, neither special-cased a returning fully-onboarded user. Collapse any similar duplication in `apps/ios/`.
- **Watermark/compose/edit before the final signature.** The trio: the C2PA hash binding must cover the exact bytes that get uploaded and shared, so watermarking after signing invalidates the binding. If Mapvest ever adds any signed-asset path (a signed PDF memo, a signed export of a brief), do all transforms *first*, then sign.
- **Supabase Edge runtime (Deno) `crypto.subtle.verify` doesn't implement ECDSA P-384 + SHA-256.** The trio's App Attest verifier originally used WebCrypto; passed every local Deno test, then 500'd every real request. Use `@noble/curves`; keep a test that stubs `crypto.subtle.verify` to throw and requires the verifier to still pass.
- **Supabase's passkey registration requires an already-authenticated non-anonymous user**, which conflicts with a passkey-first signup flow. The trio pivoted to Sign in with Apple's `signInWithIdToken` for exactly this reason. Prior art if the auth model is still open.
- **Dropping a client-written column that's being replaced by a server-written one requires a graveyard period.** PostgREST rejects unknown columns with PGRST204, so until no build in the wild writes the old column, keep it alive (unused on the read path) alongside the new one. (`the-human-internet-app/CLAUDE.md` → "`display_first_name`/`display_last_name` are dead".)

---

## How to use this doc

**Implement every numbered item.** For Mapvest specifically, start with **§1 (durable optimistic queue)** and **§2 (attestation gating on identify)** — the queue because capture→identify→resolve is a long pipeline that currently either blocks the UI or loses finds on bad network, and attestation because the identify endpoint is the one thing that must only accept real-user real-capture traffic. Then work through the rest, one PR per section, each on its own worktree branched from `main`. Only skip an item with a written reason inside a strike-through.

Written by Claude on 2026-10-05 from the state of the three sibling repos on that date.
