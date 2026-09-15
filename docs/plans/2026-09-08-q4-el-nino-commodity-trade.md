The trade is **long sugar / short soy**. Not the five-leg Hormuz + El Niño soup.

On a $100k book, held with no forced expiry:

| Side | Vehicle | $ | Shares (at 8 Sep 2026 print) |
|---|---|---|---|
| **Long** | `CANE` (Teucrium Sugar, ICE #11 ladder) | **$55,000** | ~4,787 @ $11.49 |
| **Short** | `SOYB` (Teucrium Soybeans) | **$25,000** | ~899 @ $27.80 |
| **Cash** | T-bills / money-market | **$20,000** | dry powder if CANE revisits ~$9 |

Gross ~$80k, net long ~$30k. This is research, not advice.

That is the Peter Gregory version: one structural pair, sized so you can sit. Everyone else is already long the front-page shocks.

## Why this pair, not the deck you were handed

I pulled live marks and 1y/2y histories off Mapvest production `GET /v1/quote` and `GET /v1/quote-history` (Massive). Then checked the weather and chokepoint claims against NOAA and Reuters, not the slide.

**The ENSO shock is real, and it is east-based.** NOAA CPC, 8 Sep 2026: El Niño Advisory; weekly SST anomalies Niño 1+2 **+3.9°C**, Niño 3 **+2.7°C**, Niño 3.4 **+1.8°C**; JJA RONI **+1.4°C**. Greater than 90% chance of a very strong event this fall/winter; **69%** chance OND 2026 is historic (RONI ≥ +2.5°C, strongest since 1950). The “~4°C Eastern Pacific” line is Niño 1+2, not the Niño 3.4 index people quote. That eastern heat is the canonical EP El Niño pattern: dry SE Asia / India / east Australia, wet southern South America, warm northern-tier US winter.

**Hormuz is also real — and already in the tape.** Kpler via Reuters: ~10 commodity ships/day through Hormuz (10-day average), lowest since May, after US–Iran tanker strikes. Brent ~$97–98, WTI ~$92–93 on 8 Sep; Houthi hits on Saudi sites the same day. BNO is **+88% over 1y**, vol ~45%, sitting near the 1y high. That is not a neglected bet.

What the proposed basket gets wrong:

| Proposed leg | Live fact | Call |
|---|---|---|
| Long `JO` | Delisted 14 Jun 2023. Production quote is a **2023-06-08** Yahoo leftover at $54. `NIB`/`SGG` are dead too. No live US coffee ETF (`CFNE` 502). | **Untradeable.** Arabica is also already ~325¢/lb. The El Niño coffee hit is Vietnam Robusta, not ICE Arabica. |
| Long `BNO` | +88% 1y, Brent ~$97. Hormuz has been a live war since late Feb. | **Too late / too consensus.** Street still talks fade (Goldman Dec Brent was just lifted toward $85). |
| Long `CPER` | +47% 1y, **at the 2y high** ($40.88). FCX/SCCO ripped ~+5.6% today. | **Chasing.** Chile flood / Zambia drought is a real mechanism; the price already moved. |
| Short `UNG` | NOAA does favor a warm northern-tier winter. But UNG is already **−19% 1y / −37% 2y**, vol **57%**, HH ~$2.9. Qatar/Hormuz LNG is offline and **JKM/TTF are ~$24 vs HH ~$2.9** because US liquefaction is maxed, not because the US is “safe to short.” Downside from here is a couple of dollars; a cold snap reprices the ETF violently. | **Wrong payoff.** Do not short a cheap, 57-vol thing “indefinitely.” |
| Short `SOYB` | **At the 2y high** ($27.80), +30% 1y, vol only 13.5%. El Niño historically **raises** Argentine / southern-Brazil / Paraguay soy yields. | **Keep.** This is the clean short. |
| Long `CANE` | +5.6% 1y, **−5.9% over 2y**, vol 21%. ICE #11 ~18.0–18.5¢/lb. India export ban still on through at least 30 Sep 2026. 2015–16 sugar **doubled**. | **Keep. This is the long.** |

Australian wheat “down 60%” is not real. ABARES Sep 2026: wheat **−17% YoY to ~29.8–29.9 MMt**, still **~3% above the 10-year average**, yields revised **up** after a wet winter. `WEAT` is Chicago wheat anyway, not ASX.

`CANE` vs `SOYB` daily correlation over the last year is **0.10**. This is not a statistical hedge. It is two separate El Niño signs that happen to point opposite ways. Size them as two bets, not as a market-neutral pair.

`CANE/SOYB` ratio is **0.413** vs 1y mean **0.422** and 1y max **0.518**. Sugar is the cheap leg versus soy.

## The actual “fluid” move (without fake Navier–Stokes)

There is no Navier–Stokes solver in this repo, and you should not trade a PDE metaphor. The useful mapping from a coupled-shock frame is simpler:

1. **Boundary condition that is still building:** east Pacific heat (Niño 1+2 +3.9°C), 69% historic OND. Crop damage in Asia/India/Thailand has a **6–12 month lag**. That is still ahead of the tape.
2. **Pipe that has already been constricted for ~6 months:** Hormuz. Oil, copper, nitrogen fertilizer (`CF` +44% 1y) already repriced.
3. **Node that has not equilibrated:** raw sugar still ~18¢ with an India export ban, a strengthening EP El Niño, and Middle East urea/phosphate still impaired. Soy is at a two-year high going into a South American planting season that this climate pattern usually **helps**.

2015–16 is the analog that actually paid: sugar was the standout, soy was the structural beneficiary of rain. Macrobond’s multi-cycle tape agrees on the direction (sugar/palm/cocoa up in El Niño; soy stronger in La Niña).

Palm oil is probably the *purest* SE Asia drought trade (Barclays has talked +30–40% on palm/rubber). There is no clean US vehicle. Coffee’s right contract is Robusta, also no clean US vehicle. So the executable book is sugar vs soy.

## How to sit in it

Teucrium `CANE`/`SOYB` are laddered futures pools, not a Nov vs Dec pick. Next `CANE` roll is **29 Sep 2026** (Mar ’27 → Jul ’27). That is the right structure if you are willing to hold: you never take delivery. You do get a **K-1**, and you eat roll yield.

**Invalidation (levels, not a tight stop):**
- NOAA downgrades off “very strong / historic” El Niño.
- CONAB / Brazil Center-South prints a blowout cane crop and ethanol mix does not tighten sugar.
- ICE #11 loses ~14¢ or `CANE` loses the 1y floor around **$9.00** on a closing basis — then the long is wrong, not “cheap.”
- Cover `SOYB` if Argentina / Uruguay / southern Brazil flip to drought (EP El Niño can fail locally) or China restocks violently.

**Do not add:** `JO`, `UNG`/`KOLD`, more `BNO`/`UCO`, more `CPER`/`COPX` as core. If you want a small polycrisis satellite later, `MOS` (phosphate, still −26% over 1y) is the fertilizer name that has *not* already run; `CF` has.

**Rough analog math, not a forecast:** if `CANE` does a 2015-style +50% and `SOYB` gives back 15% of the rally, that is about +$31k on the $80k deployed. If `CANE` goes back to $9.20 and soy squeezes +15%, you are about −$12.5k plus whatever cash yields. The left tail on the short is the risk; that is why it is $25k, not $50k, and why $20k stays in cash.

Sources: [NOAA CPC 8 Sep 2026 ENSO briefing](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/lanina/enso_evolution-status-fcsts-web.pdf); [Reuters Hormuz 7 Sep](https://www.reuters.com/world/middle-east/hormuz-traffic-dips-lowest-since-may-after-us-iranian-strikes-ships-2026-09-06/); [Reuters oil 8 Sep](https://www.reuters.com/business/energy/oil-rises-risks-prolonged-mideast-conflict-heighten-supply-worries-2026-09-08/); [ISO sugar](https://www.isosugar.org/prices.php?pricerange=last30) ~18.5¢/lb 4 Sep; [ABARES Sep 2026 crop report](https://www.agriculture.gov.au/abares/research-topics/agricultural-outlook/australian-crop-report/september-2026); [Macrobond ENSO/commodity cycles](https://www.macrobond.com/resources/macro-trends/el-nino-from-ocean-temperatures-to-economic-risk); Mapvest production quotes/history as of 2026-09-08T18:29Z.

Situate/research packets are not built for these tickers (`GET /v1/situate/CANE` → 404). Exa MCP was rate-limited; Doppler is not mounted in this environment, so this used the live public API + NOAA/Reuters rather than a made-up tape.
