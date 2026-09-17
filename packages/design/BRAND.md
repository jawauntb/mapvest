# Mapvest — World Bible (v2)

This document was written against the actual codebase, not from the pitch
deck. v1 introduced language and rituals that were mostly aspirational.
v2 keeps what actually holds up in the product, corrects what didn't, and
names the moves that are still open.

## Premise

A can of soda on a shelf and a bottle of shampoo in a drugstore aisle are
legal claims on a public company's future cash flows, and nobody standing
there thinks about them that way. Mapvest removes the packaging. Point the
camera at the object and what comes back isn't the product — it's the
company behind it, priced, charted, and sourced.

The mechanic is the whole product. The pitch line "see a brand, get the
ticker" is the surface expression of it. The idle-state hint is exactly
"point at anything with a name on it" — keep it that way. Don't invent
metaphors the product doesn't already earn.

## Characters

Three people the world is designed for. Roughly in order of "how much of
them is already built."

- **The auditor** — the person who wants to know *how* the ticker was
  reached. Fully real in the build: the evidence layer, the source
  domains, the "confirm before acting" copy are all already there. Every
  design move should keep making the auditor's job easier, not harder.
- **The aisle analyst** — the person doing errands who starts narrating
  the market under their breath. Scans a drink, mutters about the
  multiple. The primary premise-holder for growth. Copy should sound
  like a version of this person is speaking.
- **The early spotter** — the person who catches a name before it's
  obvious. Partial infrastructure: server-side there is a per-user
  early-find bonus and a rarity classification, but no cross-user
  surface. Nothing to compete on yet. The next move for this character
  is a leaderboard built on top of what already exists — ranked on
  early finds, not raw scan count.

There is no mascot. No influencer. No hype account.

## The belonging stack (what's built, what's next)

- **Entry.** The first-open sheet already exists — one screen, no
  carousel: "See a brand. Get the ticker. Find your first one." After
  the first successful identify, comps, news, and the AI brief unlock.
  Until then those panels hold with "Comes with your first find."
- **Hierarchy.** Personal progression already exists — XP, level,
  streak, badges, plus a per-user early-find bonus. What's missing is
  anything cross-user. The next move is a leaderboard built on top of
  what's already tracked, ranked on early finds specifically, not raw
  count. (This is a *rate* ranking — early across many catches, weekly
  reset. It is a different axis from first capture below, which is a
  *permanent, per-company* land-grab. Ship both; do not merge them.)
- **Rituals.** Daily quests already ship. A full weekly system —
  closing Saturday noon UTC — exists on the server and is completely
  unwired to the app. The cheapest real move on this whole document is
  wiring up what's already built before designing anything new.
- **Shaming (soft).** Done. A `low`-confidence identify switches the
  result card's border to a dashed warn tone, tints the confidence
  pill, and prints an explicit "treat as a lead, not a conclusion"
  note. A shared low-confidence card now reads as tentative, not
  solid.
- **Exit.** For anyone signed in, exit cost already exists — accounts
  tied to a magic link, and finds, XP, level, and streak all live on
  the server and survive a reinstall. Guests are asked to sign in at
  the second find, a rare or legendary catch, or a return after three
  days — never on first-open. Sign-in replays the local guest journal
  through `POST /v1/finds` so those catches stay in the universe.

## Language (real product vocabulary)

Everything below is confirmed in the codebase. Words in italics are
proposals, not canon; don't drop them into user-facing copy until they
actually ship somewhere.

Canon (already user-facing):

- **Confidence** — the categorical label on every identify: `High`,
  `Medium`, `Low`. Never a synthesized percent shown to a user.
- **Evidence** — the sources card. Every ticker on the primary
  result screen is accompanied by evidence.
- **Universe** — the user's saved-finds journal. Every screen that
  refers to "the collection" or "your list" should say universe.
- **Find** (noun and verb) — the primitive. "Your find," "find your
  first one," "3 finds this week."
- **Capture** / **Identify** — the two verbs for the core act. Not
  "scan," not "resolve"; those turned out to be mostly internal.
- **Comparable** — the private-brand → public-company bridge.
- **Streak** — the daily-return signal.
- **Rarity** — the classification `common` / `uncommon` / `rare` /
  `legendary` already tagged on finds server-side.

Proposals (not canon yet — don't ship as copy until earned):

- *aisle alpha*, *tell*, *miss*, *the room*, *the tape*, *the
  cartographer*, *seen* (a place on the map, not yet a Find), *first
  capture* (the permanent per-company land-grab — see below).

## Mechanics — evidence rule

The loop matches the build: capture → identify → confidence → then
comps, news, the AI brief → then save or share. The evidence rule is
now true everywhere it applies:

- The **primary** result carries an evidence card, even a flagged
  warning when sources are empty.
- A **secondary "also found"** result carries a compact `Evidence · N`
  chip (or "No citations" in warn tone).
- The **detail screen**'s evidence section is `defaultOpen` — no extra
  tap to see where a number came from.

"Never a ticker without evidence" holds. Any new surface that renders
a ticker inherits this rule from day one — see the checklist.

## Chance — rarity as the moment-of-catch signal

A rarity classification (common through legendary) already exists on
the server, and the exact case that matters — a private-label product
that traces back to a public parent — is already tagged **rare**. It
just isn't shown anywhere except as an aggregate count on the universe
screen.

The move is not building a rarity system. It's surfacing the one that
already exists, at the moment of the catch, on the result card itself.
`POST /v1/identify` now stamps `rarity` on each Investable; `GET /v1/finds`
stamps it on each journal row. The camera result shows rare and legendary
in place; common stays off the primary card and appears on universe rows.

## The capture economy (open moves)

The camera is the only spawn mechanic in Mapvest, and that is the
whole moat. A map can place a coordinate; it cannot know that the
store-brand soda in someone's cart traces to a public parent. Every
move below protects that fact instead of quietly routing around it.

- **Proximity reveals; it never catches.** Walking near a resolvable
  place surfaces it on the map — free, no quota spent. A Find still
  only happens through capture. Two states, one already canon: a
  *seen* place (proposal, not shipped copy yet) is on the map but not
  yet a Find; a *captured* place is a Find, exactly as today.
- **First capture is a second, permanent axis — not the leaderboard
  above.** The Hierarchy leaderboard ranks *rate* (early across many
  catches, resets weekly). First capture ranks a *land-grab*: the
  first Finder to ever capture a given company, full stop, no reset.
  Both need the same public handle, built once as its own item — not
  duplicated between the leaderboard and the first-capture badge.
- **Rank the gallery; don't vote it.** Each company gets a photo
  gallery (first capture pinned, then ranked by net score). Formal
  consensus voting (Wikipedia-style) needs more submissions per
  company than the product has today to mean anything — revisit once
  galleries are dense.
- **The anti-fraud floor is non-negotiable before any of this ships.**
  Capture stays live-camera-only — no photo-library upload feeds a
  first-capture claim. A submission's geotag and EXIF must match the
  claimed location. A tie is broken by server receipt time, never a
  client clock. A downvote costs the submitter XP and buries the
  photo in the gallery; it can never strip an already-granted
  first-capture badge — that would turn downvotes into a way to steal
  someone else's catch.
- **Credits fund the race.** A first-capture attempt spends the same
  metered identify quota as any capture. That gives the paid tier a
  reason to spend, not hoard — this product's monetization angle
  should live here, not in a separate upsell.
- **The co-op moment is the raid.** A map tile can be uncovered
  together — several distinct Finders capturing inside it within a
  window unlocks a shared reward. Build it on the existing tile unit
  and the existing Saturday-noon-UTC scheduler (see Handoff) instead
  of new infrastructure.
- **Research depth is a pillar, not something to trim.** Prism,
  Situate, comps, news, financial ratios, options chain, SEC filings
  — all of it stays. An investor-grade Finder values exactly this
  depth; a real conversation on the record made that concrete ("does
  your app make recommendations... that would be useful for retail
  investors" — the honest answer is yes, via Prism's posture grammar,
  evidence-backed, never a bare call). Where several research
  surfaces on the same ticker look like clutter, fix it with a clearly
  labeled entry point that indexes what each one is for. Never fix it
  by deleting one.

See `HANDOFF_CAPTURE_ECONOMY.md` for the shippable breakdown. Every
rule in this section binds that document the same way the rest of
this Bible binds `HANDOFF.md`.

## Aesthetic

Fixed rules — do not adjust without changing this document:

1. **Dark base, always.** No light theme.
2. **Two accents by design.** A primary signal color for the invest
   side (`--mv-accent`, jade). A secondary color reserved specifically
   for the map, secondary actions, chart palettes, and progress
   (`--mv-accent2`, signal-blue). **Never purple.**
3. **Confidence and evidence travel with every result** — not only
   the primary one. This is a rule about presence, not a rule about
   color.
4. **Typography is fixed.** Syne for display, IBM Plex Sans for body,
   IBM Plex Mono for tickers and numbers. Tickers are always mono and
   uppercase.

## The refusal — and the one page that breaks it

Mapvest identifies. Mapvest does not recommend. The primary flow
already states a **posture** (favorable / balanced / unfavorable),
never a price target, and every generation prompt is explicitly
banned from producing buy or sell calls.

Except one page. The **Prism** dashboard still renders literal buy
and sell action labels, a conviction meter, and a price-target
ladder. That page is the single thing keeping the refusal from being
true across the whole product.

Fix (partially applied in this pass): the action grammar shipped
under `apps/ios/src/prism/format.ts` is being reframed to posture
labels (`Favorable` / `Leans favorable` / `Balanced` / `Leans
unfavorable` / `Unfavorable`) with the same underlying signal keys, so
the rest of the surface keeps working while the vocabulary matches the
rest of the product. "Conviction" becomes "confidence in this posture"
in text, and the exit-target ladder is captioned as *scenario*
prices, not *targets*.

## The everyday (Tuesday)

The daily use is a byproduct of errands already being run, not a
dedicated session. A Finder walks past a shelf, points at a bottle,
gets a comparable and an evidence card, and closes the app. Design
for interruption — every screen should tolerate being backgrounded
after two seconds.

## Tone rules — what Mapvest says, what it doesn't

Says:
- "See a brand. Get the ticker."
- "Point at anything with a name on it."
- "Every find, with sources."
- "Not advice — evidence."

Never says:
- "Unlock the power of…" / "Revolutionize your…" / "AI-driven insights"
- "Beat the market." / "Alpha." (except where it is a defined finance
  term inside Prism.) / "Trade like a pro."
- Any implied return, backtested or otherwise.
- Emoji as garnish. A stray 🚀 disqualifies a piece of copy.

## Principles (win over any specific rule)

- **Consistency beats detail.** One consistent sentence beats fifty
  adjustments. When in doubt, delete the adjective.
- **Interpretation over exposition.** Show a slice; let inhabitants
  infer. If a screen has more than one paragraph of copy, cut one.
- **Believability, not realism.** A number without a source is
  unbelievable no matter how "real" it is. A comparable with a
  citation is believable even when it is a heuristic.
- **Don't invent language the product hasn't earned.** Marketing
  words that never appear in the app are decoration. Anchor to the
  canon list.

## Checklist (run before shipping a surface)

1. Does the copy rest on the premise (a product on a shelf is a
   claim on future cash flows)? If not, rewrite.
2. Are we using canon language (confidence, evidence, universe,
   find, capture, identify, comparable, streak, rarity) instead of
   invented tokens?
3. Is every result on this screen accompanied by evidence?
4. Is confidence shown on every result, not only the primary one?
5. Any hype words? Cut them.
6. Any buy/sell/recommendation language outside a defined posture
   grammar? Cut it or reframe.
