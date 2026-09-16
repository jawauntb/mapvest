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
  count.
- **Rituals.** Daily quests already ship. A full weekly system —
  closing Saturday noon UTC — exists on the server and is completely
  unwired to the app. The cheapest real move on this whole document is
  wiring up what's already built before designing anything new.
- **Shaming (soft).** Confidence bands already exist (`High` /
  `Medium` / `Low`) and are visible on the result pill. Today they
  render with identical neutral styling, and a result card's color
  comes from category, not confidence. The move: give a low-confidence
  result a visibly less-certain look so sharing one unchecked reads as
  careless instead of clever.
- **Exit.** For anyone signed in, exit cost already exists — accounts
  tied to a magic link, and finds, XP, level, and streak all live on
  the server and survive a reinstall. The gap is guests: anyone who
  never signs in accrues nothing. Priority isn't more persistence —
  it's converting guests before they have a reason to leave.

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
  cartographer*.

## Mechanics — evidence rule

The loop matches the build: capture → identify → confidence → then
comps, news, the AI brief → then save or share. The evidence rule is
not fully true yet.

- The **primary** result always carries an evidence card, even a
  flagged warning when sources are empty. Correct.
- A **secondary "also found"** result shows a ticker with no evidence
  card at all. Not yet correct.
- The **detail screen** buries evidence in a section collapsed at the
  bottom. Not yet correct.

To make "never a ticker without evidence" true everywhere, evidence
must travel with every result — primary and secondary — and stop
being collapsed by default.

## Chance — rarity as the moment-of-catch signal

A rarity classification (common through legendary) already exists on
the server, and the exact case that matters — a private-label product
that traces back to a public parent — is already tagged **rare**. It
just isn't shown anywhere except as an aggregate count on the universe
screen.

The move is not building a rarity system. It's surfacing the one that
already exists, at the moment of the catch, on the result card itself.

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
