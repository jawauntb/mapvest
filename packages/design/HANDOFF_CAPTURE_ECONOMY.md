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
   (leaderboard) are still open — two items below depend on them.
3. [`AGENTS.md`](../../AGENTS.md) — the repo's ground rules for agents.
4. This file.

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

## Item 2 — Global first capture + photo gallery

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
    lat, lng, exifTimestamp, serverReceivedAt, score }`. Race
    arbitration for `firstCapturedBy` is **`serverReceivedAt`**, never
    a client-supplied timestamp.
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
  - Public handle: depends on `HANDOFF.md` Item 3's handle work
    (`finder-<8hex>`, renameable). If Item 3 has not shipped when this
    item starts, add the minimal handle field yourself but use Item
    3's exact schema/validation (`[a-z0-9-]{3,20}`) so the two don't
    diverge.
  - Credits: submitting a first-capture attempt spends the same
    metered identify quota surfaced today via `usePaywall` /
    `useEntitlements` (`apps/ios/src/billing/*`) — do not add a
    separate currency.

**Acceptance.**
- Two users racing to capture the same never-captured company: the
  one whose upload the server receives first gets `firstCapturedBy`,
  regardless of on-device capture time or clock skew.
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
  regardless of request order in the test); geotag-mismatch
  rejection; downvote lowers score and debits XP without touching
  `firstCapturedBy`.
- `apps/ios/src/api/photos.test.ts` (new) — schema parse, happy and
  empty-gallery cases.

**Non-goals.**
- No canonical-image consensus voting yet (Wikipedia-style). Ship the
  ranked gallery; revisit voting once galleries are dense enough for
  quorum to mean something.
- No new rarity tier. First capture is orthogonal to `DexRarity`, not
  a fifth tier of it.
- No broker/order-related language anywhere on this surface — same
  refusal that governs the rest of the product.

---

## Item 3 — Co-op tile uncover (the weekly raid)

**Status.** Depends on Item 1 (seen/captured tiles) and Item 4b below
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

## Item 4 — Consolidate / delete (do this alongside, not after)

Two cleanups the Bible's own principles already call for
("Consistency beats detail... delete the adjective") that nobody has
picked up. Neither depends on Items 1–3; ship whenever convenient, but
**4b blocks Item 3**.

### 4a — One AI-brief generator, not four

**What exists today.** Four separate ways to generate a write-up on
the same ticker: Prism's memo (`apps/ios/src/prism/MemoSection.tsx`),
Situate's memo (`apps/ios/src/situate/MemoSection.tsx`), the detail
sheet's "Full brief" (inline prompt at
`apps/ios/app/detail/[id].tsx:768`), and the detail sheet's separate
"Memo" via `generateMemo` (`apps/ios/app/detail/[id].tsx:1120-1135`,
button at `:1153`).

**Move.** Keep two registers, not four: Situate's memo (the fixed,
posture-only structured writeup) and the detail sheet's "Full brief"
(the on-demand deep dive from the research agent). Remove the
`generateMemo` path and its button — it duplicates Situate's job
through separate plumbing. Prism's own memo can stay only as long as
Prism itself does; do not expand it.

**Acceptance.** Only two ways to generate a ticker write-up remain
reachable from the detail sheet. No dangling references to
`generateMemo` (check `apps/ios/src/api/client.ts` for the export and
remove it once the last caller is gone). Existing Situate/Full-brief
tests still pass unchanged.

**Non-goals.** Do not touch Prism's posture-grammar reframe — that's
decided (`BRAND.md` § The refusal) and in progress; this item is only
about the redundant memo path.

### 4b — Repurpose Rivalries instead of building a new scheduler

**What exists today.** A complete weekly system — `apps/api/src/routes/rivalries.ts`,
`apps/api/src/lib/scheduler.ts` (Saturday-noon-UTC close),
`apps/api/src/lib/notifiers/rivalryNotifier.ts`,
`apps/api/src/lib/rivalries-store.ts` — with **zero client surface**.
No screen, no API client call, no notification handler on the iOS
side.

**Move.** Don't delete it and don't wire it up as originally scoped
(solo weekly matchups). Repurpose its scheduler and notifier for
Item 3's weekly co-op-tile close instead — it's the same
Saturday-noon-UTC boundary this whole document already needs, already
built, already tested server-side. Retarget `rivalryNotifier.ts` to
fire on tile-uncover completion rather than matchup resolution, and
retire the matchup-specific rows in `rivalries-store.ts` that Item 3
doesn't use.

**Acceptance.** Item 3 ships with no new scheduler code. The
Saturday-noon-UTC job that used to compute solo matchups now computes
tile-uncover payouts. No orphaned matchup code paths remain reachable.

**Non-goals.** Do not resurrect the original solo-matchup concept
alongside this. If solo rivalries turn out to be wanted later, that's
a fresh scoped item, not a revival of this dead code.

---

## Cross-cutting reminders

All of `HANDOFF.md`'s reminders apply unchanged — canon language,
the refusal, the evidence rule, two accents, motion tokens. Two more,
specific to this workstream:

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

## Order and dependencies

- Item 1 (seen/captured) is closest to standalone — the only external
  dependency is the native widget target, which is a straightforward
  schema extension, not a blocker.
- Item 4a (consolidate briefs) is fully standalone. Ship it anytime.
- Item 4b (repurpose Rivalries) is standalone infrastructure work but
  **blocks Item 3** — do it before or alongside Item 3, never after.
- Item 2 (first capture + gallery) is the biggest lift and soft-depends
  on `HANDOFF.md` Item 3 (public handles) for attribution copy. If
  Item 3 is unshipped, add a minimal handle rather than block.
- Item 3 (co-op tile) depends on Item 1 (tile seen/captured state) and
  Item 4b (repurposed scheduler). Ship last.

## Definition of done for this workstream

1. Items 1–4 above are each merged to `main` behind their own PRs with
   auto-merge enabled.
2. `bun test apps/ios/src` and `bun test apps/api/src` are green.
3. A fresh install can: see a seen-but-uncaptured place on the map and
   the native widget, capture it, see it become the company's first
   capture (or not, if already claimed), vote on another Finder's
   photo, and watch a shared tile flip from a co-op capture — all
   without a single buy/sell/recommendation word anywhere in the flow.
4. `BRAND.md`'s checklist returns "yes" on every question for each new
   surface this workstream ships.
