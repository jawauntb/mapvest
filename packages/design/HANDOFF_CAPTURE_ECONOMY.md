# Mapvest — capture economy handoff

This document exists so any agent (or human) can pick up the pending
work from the capture-economy pass and finish it without re-reading
the whole session. Each section is scoped to a single, shippable
outcome. Complete them one at a time, in the order given, and verify
the acceptance checklist before opening a PR.

**Read first, in this order:**
1. [`BRAND.md`](./BRAND.md) — the World Bible (v2), specifically
   **§ The capture economy (open moves)**. Every move below quotes
   from it. If you disagree with a move, argue against the Bible, not
   this handoff.
2. [`HANDOFF.md`](./HANDOFF.md) — the prior workstream (entry gate,
   weekly quests, leaderboard, guest-convert, server rarity). Items 1,
   4, and 5 there are merged. Item 2 (weekly quest client) and Item 3
   (leaderboard) are still open — items below depend on them.
3. [`AGENTS.md`](../../AGENTS.md) — the repo's ground rules for agents.
4. This file.

**Revision note.** An earlier version of this document proposed
deleting one of four AI-brief generators as a "consolidation." That
move is withdrawn — see Item 5b. Mapvest keeps every research surface
it has; the fix is navigation, not deletion. Handles are also now a
first-class item (Item 2), not a footnote inside Item 3 — both
`HANDOFF.md`'s leaderboard and this document's first-capture
attribution need the same handle system, built once.

## Shipping conventions

Same as `HANDOFF.md`: trunk-based, one item per PR, auto-merge
enabled (the owner's standing instruction is "always auto-merge
PRs"), never `--no-verify`, never force-push to `main`. Commit-message
trailer: `Co-Authored-By: <your model> <noreply@anthropic.com>`.

## Verification pattern (run before every PR)

```
bun install
bunx tsc --noEmit --project apps/ios/tsconfig.json
bun test apps/ios/src
bunx tsc --noEmit --project apps/api/tsconfig.json
bun test apps/api/src
(cd apps/landing && bun run build)
```

The same pre-existing `bun:test` type-declaration errors and the
`situate/[ticker]` route-type error noted in `HANDOFF.md` are still
not yours to fix here. Everything else must be clean.

---

## Item 1 — Seen vs captured on the map layer

**Goal.** Proximity should surface what's catchable nearby without
ever catching it. Two states: a place you've walked near is *seen*
(free, no quota spent); a place you've photographed is *captured*
(a Find, exactly as today). The camera stays the only way to convert
one into the other.

**Why (from the Bible).** *"Proximity reveals; it never catches...
Two states, one already canon: a seen place (proposal, not shipped
copy yet) is on the map but not yet a Find; a captured place is a
Find, exactly as today."*

**Where.**
- Server: extend the nearby-resolve path (`apps/api/src/lib/nearby-resolve.ts`)
  to return candidates the client hasn't captured yet, tagged
  `state: "seen" | "captured"` per tile. Reuse the existing tile
  primitives in `apps/api/src/lib/territory.ts` (`tileFor`,
  `tileBounds`, `tileCenter`) — do not invent a second tile system.
- Client:
  - `apps/ios/src/api/types.ts` — add a `SeenEntry` type distinct from
    `Find` (deviceId or userId, brandId/companyId, tile, firstSeenAt).
    Do not merge it into the `Find` schema; a seen entry has no
    evidence, no confidence, no rarity — it is not a result.
  - `apps/ios/app/(tabs)/map.tsx` — render seen candidates as an
    outline/greyed pin, captured ones filled, using the existing
    sector-color convention (`apps/ios/src/util/sectors.ts`).
  - Native widget: `apps/ios/targets/widget/DiscoveryWidgetComponents.swift`
    (`"MAP AREA DEX"` header, `"SECTOR DEX"` section) and the RN-side
    feed in `apps/ios/src/widgets/widgetSnapshot.ts` /
    `widgetDiscoverySyncCore.ts` — this widget is the clearest existing
    expression of "what's around me," so it should carry the
    seen/captured split too, not just the in-app map. Extend
    `WidgetDexSnapshot` / `WidgetNearbyCandidate` with the same
    `state` field rather than adding a parallel shape.
- Confidence, evidence, and rarity stay exactly where they are today —
  attached only to a captured Find. A seen entry is deliberately
  thinner.

**Acceptance.**
- Walking within tile range of a resolvable place lights it up as
  *seen* on the map and on the native widget, without spending a
  scan or touching the identify quota.
- Photographing it converts the same tile entry to *captured* and
  produces a normal Find (evidence, confidence, rarity all present).
- A seen entry never appears in `/universe`; only captured Finds do.
- Killing network mid-walk degrades to "no seen data," never a crash
  and never a false capture.

**Tests.**
- `apps/api/src/lib/territory.test.ts` (extend) — a candidate inside
  a tile with no matching Find for the device/user returns `"seen"`;
  one with a matching Find returns `"captured"`.
- `apps/ios/src/widgets/widgetDiscoverySyncCore.test.ts` (extend) —
  the snapshot builder carries `state` through unchanged when absent
  (older payload) and correctly when present.

**Non-goals.**
- Do not let proximity grant XP, rarity, or Pioneer credit. Only a
  capture does. Seen is a to-do list, not a reward.

---

## Item 2 — Public handles (single implementation, two consumers)

**Status.** Firm requirement, not optional. Both this document's
Item 3 (first-capture attribution) and `HANDOFF.md`'s Item 3
(leaderboard) need a public handle. Build it once, here, and have
both consume it — do not let two agents each ship their own.

**Goal.** Every account gets a stable, renameable public handle
that's safe to show next to a permanent badge or a leaderboard row —
never an email, never a raw user ID.

**Where.**
- Server: an auto-generated handle (`"finder-<8hex>"`) at account
  creation, unique, stored on the user record. A rename endpoint
  validated as `[a-z0-9-]{3,20}`, uniqued server-side, rate-limited to
  a sane cadence (e.g. once per 24h) to stop handle-squatting churn.
- Client: a Settings row to view/rename the handle
  (`apps/ios/app/(tabs)/settings.tsx`). Surface it anywhere a user's
  identity is shown publicly (first-capture badge, leaderboard row).
- Privacy: handles are public by construction (that's the point of a
  leaderboard and an attribution badge). Do not expose email, raw
  user ID, or precise location alongside a handle anywhere.

**Acceptance.**
- A brand-new account has a valid, unique handle with no user action
  required.
- Renaming enforces the format and uniqueness constraint client- and
  server-side, with a clear conflict error on collision.
- Both the leaderboard (`HANDOFF.md` Item 3) and first-capture badges
  (Item 3 below) read from this single handle field — grep for a
  second handle implementation before adding one.

**Tests.**
- Server: uniqueness constraint test (two accounts cannot land the
  same handle); rename validation table test (valid/invalid formats,
  taken handle).

**Non-goals.**
- No display names separate from the handle. One identity string,
  public, renameable — not a separate "real name" field.

---

## Item 3 — Global first capture + photo gallery

**Goal.** Every company gets a photo gallery. The first Finder to
ever capture a company earns a permanent, company-scoped badge —
distinct from the (separate, rate-based) leaderboard in `HANDOFF.md`
Item 3. Low-quality or faked submissions can be downvoted, at a cost
to the submitter, without threatening a badge already granted.

**Why (from the Bible).** *"First capture is a second, permanent axis
— not the leaderboard above... Rank the gallery; don't vote it... The
anti-fraud floor is non-negotiable before any of this ships."*

**Where.**
- Server:
  - New table/columns on the brand/company entity (wherever
    `packages/finance/data/brands.json`-seeded entities resolve to —
    check `packages/finance/comparable.ts` for the canonical id):
    `firstCapturedBy` (userId, ts, photoId), `captureCount`.
  - New `photo_submissions` store: `{ id, companyId, userId, photoUrl,
    lat, lng, exifTimestamp, serverReceivedAt, score, clientRequestId }`.
    Race arbitration for `firstCapturedBy` is **`serverReceivedAt`**,
    never a client-supplied timestamp. `clientRequestId` is an
    idempotency key — a retried upload after a flaky network must not
    create a second submission or spend a second credit.
  - `POST /v1/companies/:id/photos` — accepts a live-camera capture
    only (reuse whatever the identify path already uses to reject
    library picks; if it doesn't reject them today, this endpoint
    must be the one that starts doing so). Validates geotag/EXIF
    against the claimed location within the existing `TILE_RADIUS_M`
    (`apps/api/src/lib/territory.ts`). Sets `firstCapturedBy`
    transactionally, first-write-wins.
  - `POST /v1/photos/:id/vote` — `{ direction: "up" | "down" }`. A
    downvote decrements `score` and costs the *submitter* XP (reuse
    the XP ledger in `apps/api/src/lib/progress-store.ts`). A
    downvote never touches `firstCapturedBy` — that field, once set,
    is immutable from this endpoint.
  - `GET /v1/companies/:id/photos` — returns the gallery sorted: first
    capture pinned, then by `score` descending. No canonical-image
    voting yet (see Non-goals).
- Client:
  - `apps/ios/src/api/photos.ts` (new) — thin fetch + zod schema for
    the three endpoints above.
  - Company/detail page (`apps/ios/app/detail/[id].tsx`) — a gallery
    section below Evidence. First-capture entry carries a badge
    ("First captured by @handle, <date>"); every other entry gets
    up/down affordances.
  - Camera result card (`apps/ios/app/(tabs)/camera.tsx`) — when a
    capture is a company's first ever (not the same thing as the
    existing rarity chip from `HANDOFF.md` Item 5), surface a distinct
    "First capture" moment (confetti-tier haptic via
    `apps/ios/src/util/haptics.ts`, not a new rarity tier — this is
    orthogonal to `DexRarity`).
  - Handle: consume Item 2 above. Do not build a second one.
  - Credits: submitting a first-capture attempt spends the same
    metered identify quota surfaced today via `usePaywall` /
    `useEntitlements` (`apps/ios/src/billing/*`) — do not add a
    separate currency.

**Acceptance.**
- Two users racing to capture the same never-captured company: the
  one whose upload the server receives first gets `firstCapturedBy`,
  regardless of on-device capture time or clock skew.
- Retrying the same upload after a dropped connection (same
  `clientRequestId`) never creates a second submission and never
  double-charges quota.
- A photo-library-sourced image is rejected outright by the endpoint,
  not just discouraged in copy.
- A submission whose geotag doesn't match its claimed company/tile is
  rejected with a clear client error, not silently accepted.
- Downvoting a submission lowers its rank and costs its submitter XP;
  it never unsets `firstCapturedBy` even if that submission was the
  first capture.
- The gallery renders with zero submissions exactly like Evidence
  does with zero sources — a clear empty state, never a blank screen.

**Tests.**
- `apps/api/src/routes/photos.test.ts` (new) — race arbitration
  (two submissions, assert the earlier `serverReceivedAt` wins
  regardless of request order in the test); idempotent retry with the
  same `clientRequestId`; geotag-mismatch rejection; downvote lowers
  score and debits XP without touching `firstCapturedBy`.
- `apps/ios/src/api/photos.test.ts` (new) — schema parse, happy and
  empty-gallery cases.

**Non-goals.**
- No canonical-image consensus voting yet (Wikipedia-style). Ship the
  ranked gallery; revisit voting once galleries are dense enough for
  quorum to mean something.
- No new rarity tier. First capture is orthogonal to `DexRarity`, not
  a fifth tier of it.
- No content-safety scanning (NSFW/irrelevant-image filtering) in
  this pass. Flagged as a real gap for a follow-up item once the
  gallery has real traffic — not blocking for v1, but do not represent
  v1 as fully moderated.
- No broker/order-related language anywhere on this surface — same
  refusal that governs the rest of the product.

---

## Item 4 — Co-op tile uncover (the weekly raid)

**Status.** Depends on Item 1 (seen/captured tiles) and Item 5a below
(repurposed Rivalries scheduler). Do not start before both exist.

**Goal.** A map tile can be uncovered collectively: once N distinct
Finders capture something inside it within a window, the tile unlocks
a shared reward. This is the missing multiplayer retention spike —
Pokémon GO's raid, Mapvest's version.

**Why (from the Bible).** *"The co-op moment is the raid... Build it
on the existing tile unit and the existing Saturday-noon-UTC scheduler
instead of new infrastructure."*

**Where.**
- Server: a `tile_progress` counter keyed by `tile` (from
  `territory.ts`) and the current weekly cycle (reuse whatever cycle
  math `HANDOFF.md` Item 2 lands for the weekly quest window — do not
  compute a second Saturday-noon-UTC boundary). Increment on each
  qualifying capture inside the tile; a threshold (start at N=5,
  tunable) marks the tile uncovered and splits an XP pool among that
  cycle's contributors.
- Wire the increment into whatever path already records a `Find`
  (`apps/api/src/routes/identify.ts`'s `recordFind` call) — do not add
  a second capture-recording path.
- Client: a compact progress affordance on the map (`x/N this week`)
  for any tile with in-progress co-op state; a completion toast/push
  when a tile flips.

**Acceptance.**
- A tile's progress is visible to anyone viewing it, not just
  contributors.
- The XP split on completion is exact (no rounding loss silently
  dropped) and lands in each contributor's ledger without a second
  claim step.
- Progress resets cleanly at the same weekly boundary as the quest
  system — verify against the same test fixture Item 2 of
  `HANDOFF.md` used for the Saturday-noon-UTC math.

**Tests.**
- `apps/api/src/lib/territory.test.ts` (extend) — threshold crossing
  triggers exactly once per cycle per tile; a capture after the
  threshold does not re-trigger or re-split.

**Non-goals.**
- Do not build real-time presence (who else is currently in the tile
  with you). An async counter is the whole v1.

---

## Item 5 — Reuse dead infrastructure; keep every research tool

Two moves. 5a is genuine cleanup (dead server plumbing, no user-facing
loss). 5b replaces the earlier, withdrawn "delete a research surface"
idea with the opposite: an explicit commitment to keep all of them,
fixed with navigation instead of subtraction.

### 5a — Repurpose Rivalries instead of building a new scheduler

**What exists today.** A complete weekly system — `apps/api/src/routes/rivalries.ts`,
`apps/api/src/lib/scheduler.ts` (Saturday-noon-UTC close),
`apps/api/src/lib/notifiers/rivalryNotifier.ts`,
`apps/api/src/lib/rivalries-store.ts` — with **zero client surface**.
No screen, no API client call, no notification handler on the iOS
side.

**Move.** Don't delete it and don't wire it up as originally scoped
(solo weekly matchups). Repurpose its scheduler and notifier for
Item 4's weekly co-op-tile close instead — it's the same
Saturday-noon-UTC boundary this whole document already needs, already
built, already tested server-side. Retarget `rivalryNotifier.ts` to
fire on tile-uncover completion rather than matchup resolution, and
retire the matchup-specific rows in `rivalries-store.ts` that Item 4
doesn't use.

**Acceptance.** Item 4 ships with no new scheduler code. The
Saturday-noon-UTC job that used to compute solo matchups now computes
tile-uncover payouts. No orphaned matchup code paths remain reachable.

**Non-goals.** Do not resurrect the original solo-matchup concept
alongside this. If solo rivalries turn out to be wanted later, that's
a fresh scoped item, not a revival of this dead code.

### 5b — Unify the research entry point; delete nothing

**Withdrawn.** An earlier draft of this item proposed removing the
detail sheet's `generateMemo` path as "redundant" with Situate's
memo. That's the wrong move, and it's reversed here. Every existing
research surface — Prism's posture and scenario-price engine,
Situate's memo, the detail sheet's on-demand "Full brief," the
detail sheet's `generateMemo`, comps, news, financial ratios, options
chain, SEC filings — stays. This depth is a real part of the value
proposition for an investor-grade user, not noise competing with the
catch loop.

**Goal instead.** The actual complaint underneath the old
"consolidate" idea was navigation, not redundancy: four ways to
generate a write-up on the same ticker, reachable from different,
unlabeled places, can look like clutter even when every one of them
does a genuinely different job. Fix that with information
architecture, not deletion.

**Where.**
- `apps/ios/app/detail/[id].tsx` — add a single, clearly labeled
  "Research" section that indexes every engine with one line each on
  what it's for, instead of scattering buttons across the sheet:
  - **Prism** — a quantitative posture and scenario-price read
    (`Favorable` / `Balanced` / `Unfavorable`, evidence-backed — not
    a buy/sell call).
  - **Situate** — a qualitative posture memo: determinants,
    falsifiers, what's already priced in.
  - **Full brief** — an on-demand deep narrative from the research
    agent, generated fresh.
  - **Memo** (`generateMemo`) — the quick structured summary.
  - Comps / News / Financial ratios / Options chain / SEC filings /
    Evidence — the supporting data each of the above draws on.
- No engine is removed, renamed to imply it's lesser, or hidden more
  than one tap deep. The fix is that a user (or an investor being
  shown the app) can immediately see there are several distinct
  lenses on the same ticker, not four accidental duplicates.

**Acceptance.**
- All four write-up paths remain fully functional and reachable.
- A user opening the detail sheet for the first time can tell, without
  tapping anything, what each research surface is for.
- No existing test for Prism, Situate, Full brief, or `generateMemo`
  is deleted or weakened by this item.

**Non-goals.**
- Do not merge any two engines' output into one screen. They stay
  distinct lenses, not a blended feed.
- Do not use this item to quietly re-introduce the "cut down to two"
  framing. If a future agent proposes deleting a research surface
  again, that requires a new, explicit decision in `BRAND.md` — not a
  reinterpretation of this item.

---

## Cross-cutting reminders

All of `HANDOFF.md`'s reminders apply unchanged — canon language,
the refusal, the evidence rule, two accents, motion tokens. Three
more, specific to this workstream:

- **Seen is not a Find.** Never let a seen entry carry confidence,
  evidence, or rarity — those are the language of a captured result.
  If a screen is tempted to show a "confidence" on something merely
  seen, that's a sign the entry belongs in `/universe`'s empty state
  copy instead, not a new field.
- **First capture is not rarity.** `DexRarity` (common → legendary) is
  a property of the company. First capture is a property of the
  *event* — who got there first. A common-tier company can still have
  an exciting, unclaimed first capture. Don't conflate the two badges
  visually or in the data model.
- **Research depth is a pillar, not a liability.** Nothing in this
  workstream should read as trimming Prism, Situate, comps, news,
  financial ratios, options chain, or SEC filings. If a future item
  looks like it's cutting one of these to reduce "clutter," that is
  the wrong fix — the fix is navigation (5b's pattern), not removal.

## Order and dependencies

- Item 1 (seen/captured) is closest to standalone — the only external
  dependency is the native widget target, which is a straightforward
  schema extension, not a blocker.
- Item 2 (handles) is standalone and should ship early — Item 3 and
  `HANDOFF.md`'s own Item 3 (leaderboard) both need it.
- Item 5a (repurpose Rivalries) is standalone infrastructure work but
  **blocks Item 4** — do it before or alongside Item 4, never after.
- Item 5b (research navigation) is fully standalone. Ship it anytime.
- Item 3 (first capture + gallery) is the biggest lift and depends on
  Item 2 (handles) for attribution copy.
- Item 4 (co-op tile) depends on Item 1 (tile seen/captured state) and
  Item 5a (repurposed scheduler). Ship last.

## Definition of done for this workstream

1. Items 1–5 above are each merged to `main` behind their own PRs with
   auto-merge enabled.
2. `bun test apps/ios/src` and `bun test apps/api/src` are green.
3. A fresh install can: see a seen-but-uncaptured place on the map and
   the native widget, capture it, see it become the company's first
   capture (or not, if already claimed), vote on another Finder's
   photo, watch a shared tile flip from a co-op capture, and reach
   every one of Prism/Situate/Full-brief/Memo from one clearly labeled
   research entry point — all without a single buy/sell/recommendation
   word anywhere in the flow.
4. `BRAND.md`'s checklist returns "yes" on every question for each new
   surface this workstream ships.
