# Mapvest — Brand v2 handoff

This document exists so any agent (or human) can pick up the pending work
from the Brand v2 pass and finish it without re-reading the whole session.
Each section is scoped to a single, shippable outcome. Complete them one
at a time, in the order given, and verify the acceptance checklist before
opening a PR.

**Read first, in this order:**
1. [`packages/design/BRAND.md`](./BRAND.md) — the World Bible (v2). Every
   move below quotes from it. If you disagree with a move, argue against
   the Bible, not the handoff.
2. [`AGENTS.md`](../../AGENTS.md) — the repo's ground rules for agents.
3. This file.

## Shipping conventions for this workstream

- The repo is trunk-based. **Ship each item as its own PR** and enable
  GitHub auto-merge; the owner's standing instruction is "always
  auto-merge PRs." Do not batch two of these items into one PR — a
  reviewer needs to see them independently.
- Commit-message trailer: `Co-Authored-By: Claude Opus 4.7
  <noreply@anthropic.com>` (or your model's equivalent).
- Never skip hooks (`--no-verify`) and never force-push to `main`.
- If a piece of work needs a new server endpoint, ship the server change
  and the client consumption in the same PR when possible; if not, ship
  the server change first behind a feature flag and consume it in the
  follow-up PR.

## Verification pattern (run before every PR)

```
# From repo root
bun install
bunx tsc --noEmit --project apps/ios/tsconfig.json      # iOS types
bun test apps/ios/src                                    # iOS unit tests
bunx tsc --noEmit --project apps/api/tsconfig.json       # server types
bun test apps/api/src                                    # server tests
(cd apps/landing && bun run build)                       # landing build
```

Preexisting `bun:test` type-declaration errors and a `situate/[ticker]`
route-type error already exist on `main`; they are not yours to fix in
this workstream. Everything else must be clean.

---

## Item 1 — Gate the full feature set behind the first successful identify

**Goal.** A first-time Finder cannot open comps, news, or the AI brief
until they have completed at least one successful identify. The first-open
sheet is a promise; this move makes it a ritual.

**Why (from the Bible).** *"The first-open sheet already exists as one
screen … What it doesn't do yet: gate anything. The next move is to hold
the full feature set (comps, news, the AI brief) until the first identify
actually completes."*

**Where.**
- Client state: `apps/ios/src/finds/*` already tracks `finds`. Introduce
  a derived `hasFirstFind` selector — true when `listFinds()` has ever
  returned ≥1 find for the current session/device (also true for a
  guest whose local queue has produced at least one successful identify).
- Storage for the guest case: add a lightweight `AsyncStorage` key
  (`mapvest.firstFind.v1 = "1"`) written by the camera result path
  immediately after a primary `Investable` renders. Fail-closed —
  storage failures leave the gate up, they don't unlock it.
- Gates:
  - `apps/ios/app/detail/[id].tsx` — comparables section, news section,
    daily brief card, AI-generated memo sections. Render a compact
    "Locked until your first find" panel with a "Point at anything with
    a name on it" CTA that pushes to `/(tabs)/camera`.
  - `apps/ios/src/prism/*Section.tsx` — same gate above every AI-brief
    section (`MemoSection`, `ChatSection`, `NewsSection`,
    `RelationalSection`). Fundamentals, price chart, and evidence stay
    open — they are the reader's on-ramp.
- The gate panel should reuse `EmptyState` (icon `lock-closed-outline`,
  title `"Comes with your first find"`, body from the Bible language:
  *"Point at anything with a name on it. Every result travels with
  evidence."*).

**Acceptance.**
- A brand-new install with zero finds cannot see comps/news/brief; each
  gate renders the panel above.
- After one successful identify, every gated panel unlocks on the next
  render (verified by pulling to refresh or navigating away and back).
- A user who signs in on a device that already had a guest find keeps
  the unlock (do not require them to identify again post-auth).
- Storage failure keeps the gate up.

**Tests.**
- `apps/ios/src/finds/gate.ts` (new): a pure `hasFirstFind({ finds,
  guestFlag })` selector. Unit test the four cases: no finds + no flag →
  false; ≥1 find + any flag → true; no finds + flag "1" → true; storage
  read throws → false.

**Non-goals.**
- Do not add a paywall or plan gate here. The `Paywall` module already
  handles usage-based gates; this is a first-run ritual, not a limit.

---

## Item 2 — Wire the server-side weekly quest system to a client surface

**Goal.** The existing weekly-quest engine (closes Saturday noon UTC) has
zero client surface today. Ship a weekly card on Home, a completion
notification, and a Sunday recap screen.

**Why (from the Bible).** *"A full weekly system, closing Saturday at
noon UTC, already exists on the server and is completely unwired to the
app. This is the cheapest real move available."*

**Where.**
- Confirm the server contract first: grep `apps/api/src` for `weekly`
  and `quest`. The endpoint is likely under `apps/api/src/routes/`. Do
  not invent a shape — read what ships.
- Client:
  - `apps/ios/src/api/quests.ts` (new) — thin fetch + zod schema for
    `GET /v1/quests/weekly` (or whatever the route is), returning the
    current cycle window, the list of quests, and per-quest progress
    and reward.
  - `apps/ios/src/components/WeeklyQuestCard.tsx` — a Home surface card
    (place it between the daily brief card and top movers). Renders
    week-window (`Sun 09/15 – Sat 09/21`), each quest with a progress
    row, and a small `Closes in Nd Nh` countdown to the next
    Saturday-noon-UTC boundary.
  - `apps/ios/app/(tabs)/home.tsx` — mount the card between
    `DailyBriefCard` and `TopMoversCard`. Gate on `session?.token` (no
    weekly for guests until item 4 lands).
  - Notification: hook the existing push registry
    (`apps/ios/src/notif/*`) into a `weekly_close` and
    `weekly_completed` event with a Sunday-morning recap deep link to
    a new route `/quests/weekly-recap`.
  - `apps/ios/app/quests/weekly-recap.tsx` (new) — a one-screen recap:
    quests completed, XP earned, and the next week's quests preview.

**Acceptance.**
- Weekly card shows on Home for signed-in users with live progress.
- Countdown resolves against Saturday 12:00 UTC in every timezone; add
  a util test for a user in `America/New_York` on a Saturday at 07:00
  local (still Saturday 11:00 UTC, so the card should not have
  closed).
- Completion push fires when a quest advances from `incomplete` to
  `complete`; do not fire on subsequent progress updates.
- Recap screen deep-links from the completion notification and from a
  Home "See last week's recap" chip that appears Sun–Mon.

**Tests.**
- `apps/ios/src/api/quests.test.ts` — schema parse (happy + missing
  optional fields).
- `apps/ios/src/quests/window.test.ts` — the Saturday-noon-UTC
  boundary math across three timezones.

**Non-goals.**
- Do not redesign the reward economy; ship exactly the rewards the
  server already emits.

---

## Item 3 — Cross-user leaderboard ranked on early finds

**Goal.** A first cross-user surface. Rank users by their **early-find
score** (the per-user bonus the server already awards for catching a
brand before others do), not by raw find count. Weekly reset.

**Why (from the Bible).** *"The early spotter has partial infrastructure
and nothing yet to compete on … build the leaderboard on top of what's
already tracked, ranked on early finds, not on raw scan count."*

**Where.**
- Server: verify the early-find bonus is already persisted per-user
  per-catch (grep `apps/api/src` for `early` and `bonus`). If it's a
  computed field, materialize it into a `leaderboard` view keyed by
  `user_id, cycle_start` and expose `GET /v1/leaderboard/weekly?limit=50`
  returning `{ cycleStart, cycleEnd, rows: [{ handle, earlyFindScore,
  rank, isYou }] }`. The user's own row must always be included even
  if outside the top 50.
- Handles: users don't currently have a public handle. Add an
  auto-generated handle (`"finder-<8hex>"`) at account creation, plus a
  Settings row to rename it (validated as `[a-z0-9-]{3,20}`, uniqued
  server-side).
- Client:
  - `apps/ios/src/api/leaderboard.ts` (new).
  - `apps/ios/app/leaderboard.tsx` (new) — a plain scrollable list.
    Top row highlighted if `isYou`.
  - Entry point: add a "This week" chip on the WeeklyQuestCard (item
    2) that opens `/leaderboard`.

**Acceptance.**
- Cold render shows a top-50 list with your row highlighted (or
  appended below the top-50 if you're not there).
- Names respect the handle privacy setting; no email addresses, no
  raw user IDs.
- The list re-fetches on focus and pulls-to-refresh.
- Cycle resets Saturday noon UTC (same as item 2). Verify the header
  says `"Sun 09/15 – Sat 09/21"`.

**Tests.**
- `apps/ios/src/api/leaderboard.test.ts` — schema parse and the
  "user not in top 50" shape.
- Server: a route test that a user with zero early finds still shows
  up in `rows` when they call the endpoint with their own token.

**Non-goals.**
- Do not add follow/unfollow or DMs. This is a ranked list, not a
  social graph.
- Do not rank on raw find count; that would reward volume noise over
  the aisle-analyst catch.

---

## Item 4 — Convert-guests-to-accounts push

**Goal.** The exit-cost gap. A guest who identifies but never signs in
loses everything on reinstall. Make the sign-in prompt land at the
right moments, not on app open.

**Why (from the Bible).** *"For anyone signed in, exit cost already
exists … The gap is guests. Priority isn't more persistence — it's
converting guests before they have a reason to leave."*

**Where.**
- `apps/ios/src/auth/session.ts` + `saveContinuation.ts` — already
  handle post-identify sign-in for the save flow. Extend the same
  pattern to three new moments:
  1. **Second-find moment.** When a guest completes their second
     successful identify in a session, show a non-blocking sheet:
     *"Sign in to keep these two finds — and every one after. Your
     universe is yours from that moment on."*
  2. **First rare/legendary catch.** When rarity chip renders on a
     guest identify, show the same sheet with tailored copy: *"That's a
     rare catch. Sign in to keep it in your universe."*
  3. **Backgrounded return.** If a guest re-enters the app after ≥3
     days of not identifying, show the sheet on next foreground.
- The sheet is dismissible ("Not yet") and defers for 24h per moment
  (`AsyncStorage` per-moment cooldown key). Never shown to signed-in
  users. Never shown at cold boot.
- Copy anchors:
  - Header: `"Keep what you've caught"`
  - Body: canon language — universe, find, streak. Do not invent new
    words.
  - Primary CTA: `"Sign in"` (opens `/auth`).
  - Secondary: `"Not yet"`.

**Acceptance.**
- Sheet appears exactly once per moment per 24h window per install.
- Never appears for signed-in users.
- Never appears at cold boot (the first-open sheet has that slot).
- Sign-in flow, once completed, moves the two guest finds to the
  server-side account (this may already be handled by
  `saveContinuation`; verify — if not, extend it).

**Tests.**
- `apps/ios/src/auth/guestPromptPolicy.test.ts` (new) — pure function
  `shouldPromptGuest({ signedIn, findsThisSession, cooldownExpiresAt,
  daysSinceLastFind, latestRarity })`. Table-test the moments and the
  suppressions.

**Non-goals.**
- Do not paywall guest identifies. Guests keep the freedom to point
  and walk — the conversion is about *keeping*, per the Bible.

---

## Item 5 — Server-side rarity on `Investable` and `Find`

**Goal.** Today the client computes only `rare` (private→public bridge).
The server has full rarity classification but doesn't ship it on either
`Investable` (the identify response) or `Find` (the journal). Add it so
the client can render `common` / `uncommon` / `rare` / `legendary` at the
moment of the catch and on every universe row.

**Why (from the Bible).** *"A rarity classification, common through
legendary, already exists server-side. The fix isn't building a rarity
system. It's surfacing the one that already exists, at the moment of the
catch, on the result card itself."* The client util shipped in commit
`326539b` covers only the case we can decide without seed access;
`legendary` catches (a public brand not yet in the seed table) are
currently missable.

**Where.**
- Server:
  - Extend `POST /v1/identify` to compute rarity per resolved
    Investable using the same logic in `apps/api/src/lib/dex.ts` and
    stamp it on each item in the response.
  - Extend the finds writer to persist rarity on the row (or expose
    it as a computed field on `GET /v1/finds`).
- Client schemas (`apps/ios/src/api/types.ts`, `apps/ios/src/api/finds.ts`,
  and the mirror in `packages/core`):
  - Add `rarity: DexRarity.optional()` on `Investable` and `Find`.
  - Read defensively; older responses without the field must not
    crash.
- Camera result surface (`apps/ios/app/(tabs)/camera.tsx`) and universe
  row (`apps/ios/app/universe.tsx`):
  - Prefer server-provided `rarity` when present.
  - Fall back to the client util (`rarityFromInvestable`) when absent.
  - The rarity chip already exists; extend `SurfacedRarity` in
    `apps/ios/src/util/rarity.ts` to include `common | uncommon |
    legendary`, with distinct labels (`"Common catch"` /
    `"Uncommon catch"` / `"Rare catch"` / `"Legendary catch"`) and
    distinct colors (per the aesthetic rule: two accents, jade + blue,
    never purple — pick from the token palette).
  - Do not render a `"Common catch"` chip on the primary card by
    default; it's noise. Show it only on the universe row (where it
    adds histogram context) and elsewhere hide it. Rare and legendary
    always show.

**Acceptance.**
- A legendary identify visibly renders `Legendary catch` in-place on
  the result card.
- Every find row in `/universe` carries a rarity chip.
- An older API response without `rarity` still renders (falls back to
  client-side classification, which returns `rare` or null).
- No visual change on a common public identify (the chip is hidden).

**Tests.**
- Extend `apps/ios/src/util/rarity.test.ts` for the new label/color
  ladder.
- Server unit test that `POST /v1/identify` stamps rarity on each
  Investable using the same classifier as `/v1/dex`.

**Non-goals.**
- Do not introduce a new rarity tier ("mythic" etc.). The four-tier
  ladder is fixed in `DexRarity`.

---

## Cross-cutting reminders

- **Language.** Every user-facing string in every item above must clear
  the Bible's checklist (`BRAND.md` § Checklist). Canon is `confidence`,
  `evidence`, `universe`, `find`, `capture`, `identify`, `comparable`,
  `streak`, `rarity`. Invented tokens (*the room*, *the tape*, *the
  cartographer*) stay in the proposal column.
- **The refusal.** Nothing you add here says buy or sell. Prism's
  posture grammar (`Favorable` / `Leans favorable` / `Balanced` / `Leans
  unfavorable` / `Unfavorable`) is the only action grammar allowed.
- **Evidence rule.** Any new surface that displays a ticker must be
  accompanied by evidence — either an evidence card or a compact
  `Evidence · N` / `No citations` chip.
- **Two accents.** Jade `#14C4A6` for invest signals; signal-blue
  `#2F8FEF` for map / secondary actions. **Never purple.** Colors come
  from `tokens.ts`; don't inline hex except for tint expressions.
- **Motion.** Reuse the existing `motion` tokens
  (`packages/design/src/tokens.ts` → `springSnappy` / `springSoft`).
  Don't hand-tune spring params on new surfaces.

## Order and dependencies

- Item 1 (gate) is standalone. Do this first — highest ratio of impact
  to code.
- Item 5 (server rarity) unblocks Item 2 (weekly quest cards want a
  legendary marker) and Item 4 (rare/legendary is the strongest guest
  conversion moment). Ship 5 before 2 or 4 if you plan to use rarity in
  either.
- Item 2 (weekly quests) is a prerequisite for Item 3 (leaderboard
  belongs off the weekly card).
- Item 3 depends on Item 2's cycle math being right.
- Item 4 can ship at any time after Item 1.

## Definition of done for the whole workstream

Every one of these is true:

1. The five items above are each merged to `main` behind their own PRs
   with auto-merge enabled.
2. `bun test apps/ios/src` and `bun test apps/api/src` are green.
3. A fresh install → first find → weekly card visible → sign-in
   converts guest state → detail page shows unlocked sections → Prism
   posture chip reads the new grammar — this whole loop runs without
   inventing tokens outside the Bible.
4. The Bible's checklist at the bottom of `BRAND.md` returns "yes" on
   every question for each new surface.
