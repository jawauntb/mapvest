# Q4 2026 El Niño commodity trade

Research only. Not financial advice. $100k book, willing to hold indefinitely. Marks as of 8 Sep 2026.

---

## The trade

The trade is **long sugar / short soy**. Not the five-leg Hormuz + El Niño soup.

On a $100k book, held with no forced expiry:

| Side | Vehicle | $ | Shares (at 8 Sep 2026 print) |
|---|---|---|---|
| **Long** | `CANE` (Teucrium Sugar, ICE #11 ladder) | **$55,000** | ~4,787 @ $11.49 |
| **Short** | `SOYB` (Teucrium Soybeans) | **$25,000** | ~899 @ $27.80 |
| **Cash** | T-bills / money-market | **$20,000** | dry powder if CANE revisits ~$9 |

Gross ~$80k, net long ~$30k. This is research, not advice.

That is the Peter Gregory version: one structural pair, sized so you can sit. Everyone else is already long the front-page shocks.

---

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

---

## The actual “fluid” move (without fake Navier–Stokes)

There is no Navier–Stokes solver in this repo, and you should not trade a PDE metaphor. The useful mapping from a coupled-shock frame is simpler:

1. **Boundary condition that is still building:** east Pacific heat (Niño 1+2 +3.9°C), 69% historic OND. Crop damage in Asia/India/Thailand has a **6–12 month lag**. That is still ahead of the tape.
2. **Pipe that has already been constricted for ~6 months:** Hormuz. Oil, copper, nitrogen fertilizer (`CF` +44% 1y) already repriced.
3. **Node that has not equilibrated:** raw sugar still ~18¢ with an India export ban, a strengthening EP El Niño, and Middle East urea/phosphate still impaired. Soy is at a two-year high going into a South American planting season that this climate pattern usually **helps**.

2015–16 is the analog that actually paid: sugar was the standout, soy was the structural beneficiary of rain. Macrobond’s multi-cycle tape agrees on the direction (sugar/palm/cocoa up in El Niño; soy stronger in La Niña).

Palm oil is probably the *purest* SE Asia drought trade (Barclays has talked +30–40% on palm/rubber). There is no clean US vehicle. Coffee’s right contract is Robusta, also no clean US vehicle. So the executable book is sugar vs soy.

---

## How to sit in it

Teucrium `CANE`/`SOYB` are laddered futures pools, not a Nov vs Dec pick. Next `CANE` roll is **29 Sep 2026** (Mar ’27 → Jul ’27). That is the right structure if you are willing to hold: you never take delivery. You do get a **K-1**, and you eat roll yield.

**Invalidation (levels, not a tight stop):**

- NOAA downgrades off “very strong / historic” El Niño.
- CONAB / Brazil Center-South prints a blowout cane crop and ethanol mix does not tighten sugar.
- ICE #11 loses ~14¢ or `CANE` loses the 1y floor around **$9.00** on a closing basis — then the long is wrong, not “cheap.”
- Cover `SOYB` if Argentina / Uruguay / southern Brazil flip to drought (EP El Niño can fail locally) or China restocks violently.

**Do not add:** `JO`, `UNG`/`KOLD`, more `BNO`/`UCO`, more `CPER`/`COPX` as core. If you want a small polycrisis satellite later, `MOS` (phosphate, still −26% over 1y) is the fertilizer name that has *not* already run; `CF` has.

**Rough analog math, not a forecast:** if `CANE` does a 2015-style +50% and `SOYB` gives back 15% of the rally, that is about +$31k on the $80k deployed. If `CANE` goes back to $9.20 and soy squeezes +15%, you are about −$12.5k plus whatever cash yields. The left tail on the short is the risk; that is why it is $25k, not $50k, and why $20k stays in cash.

---

## Live marks used (Mapvest production API, 8 Sep 2026 ~18:29Z)

| Ticker | Price | 3mo | 1y | 2y | 1y vol | Note |
|---|---|---|---|---|---|---|
| `CANE` | $11.49 | +14.3% | +5.6% | −5.9% | 20.9% | Long. Near 1y high, still below 2y high $13.57 |
| `SOYB` | $27.80 | +11.1% | +30.2% | +16.3% | 13.5% | Short. At 2y high |
| `BNO` | $57.25 | +3.0% | +87.6% | +74.1% | 44.6% | Skip. Hormuz already priced |
| `CPER` | $40.88 | +5.9% | +47.5% | +48.8% | 27.4% | Skip. At 2y high |
| `UNG` | $10.49 | −7.4% | −19.0% | −36.7% | 56.8% | Skip. Wrong payoff |
| `JO` | $54 (stale) | — | — | — | — | Dead. Last print 2023-06-08 |
| `NIB` | $36.29 (stale) | — | — | — | — | Dead. Last print 2023-06-08 |
| `SGG` | $87.97 (stale) | — | — | — | — | Dead. Last print 2025-06-11 |
| `WEAT` | $26.93 | +10.0% | +25.0% | −0.6% | 23.6% | Skip. Chicago wheat, not ASX |
| `DBA` | $29.11 | +5.4% | +13.1% | +23.2% | 11.5% | Skip. Basket mixes soy into the long |
| `CF` | $135.25 | +11.1% | +44.4% | +84.2% | 42.2% | Fertilizer already ran |
| `MOS` | $26.39 | +20.2% | −25.7% | −5.7% | 45.2% | Optional satellite only |
| `NTR` | $80.64 | +14.8% | +36.5% | +60.7% | 32.5% | Already ran |
| `FCX` | $76.82 | — | — | — | — | +5.6% on the day; copper chase |
| `SCCO` | $209.82 | — | — | — | — | +5.6% on the day; copper chase |

`CANE` vs `SOYB` daily correlation (1y): **0.10**. Ratio now **0.413** vs 1y mean **0.422** / max **0.518**.

Spot / futures context the same day: Brent ~$97–98, WTI ~$92–93, ICE Sugar #11 ~18.0–18.5¢/lb, Arabica coffee ~325¢/lb, COMEX copper ~$6.54–6.56/lb, Henry Hub ~$2.9, JKM/TTF ~$24.

---

## Original proposed Q4 2026 basket (for reference)

To build a Q4 2026 commodity portfolio using the Navier-Stokes breakthrough, treat the solution as a structural framework for modeling nonlinear, multi-variable supply shocks.

In quantitative trading, the Navier-Stokes existence and smoothness solution provides a better theoretical grasp of how micro-level atmospheric or logistical inputs cascade into macro-level market chaos. When a system faces simultaneous shocks — like severe Super El Niño weather anomalies colliding with Strait of Hormuz energy and fertilizer supply-chain closures — traditional linear models break down.

By framing these disruptions as a coupled fluid-dynamics and network-flow problem, the idea was to identify structural deficits and oversupplies and build a long/short basket until year-end.

### Proposed long/short basket

A multi-variable shock framework pointed to an aggressive Long Softs & Energy / Short Selected Grains structural pair:

| Position | Asset class | Target commodity / ticker example | Strategic fluid & supply-chain rationale | Risk factors to monitor |
|---|---|---|---|---|
| LONG | Softs | Sugar (`CANE`), Coffee (`JO`) | Compounding input shocks: SE Asian and Indian crop fields suffering El Niño-driven droughts. Concurrently, Hormuz closure cut off global urea, sulfur, and phosphate fertilizer flows. Reduced acreage plus zero fertilizer → non-linear supply collapse. | Brazil over-performing on sugar logistics despite regional rains. |
| LONG | Energy | Brent (`BNO`) | Chokepoint fluid dynamics: effective Hormuz closure choked daily commodity vessel crossings to lowest since May. A fifth of global seaborne oil constrained; Sep Houthi–US escalations re-ignited risk premia into winter. | Rapid production increases from non-Gulf regions (OPEC+ fractures). |
| LONG | Metals | Copper (`CPER`) | Hydrological constraints: Super El Niño forcing climate divergence. Extreme droughts in Zambia and flash-flooding risks in Chile threatening grid stability and hydropower-reliant mines. | Sudden cooling of global industrial demand or Chinese real-estate slowdown. |
| SHORT | Grains | Soybeans (`SOYB`) | Regional climate winners: while El Niño devastates Asia, it brings heavy beneficial rainfall to southern South America (Argentina, Uruguay, Paraguay). Asymmetric supply boom; short leg to hedge long ag. | Sudden local logistics bottlenecks or port strikes in Argentina. |
| SHORT | Industrial | Natural gas (`UNG`) | Weather fade: east-based Super El Niño historically maps to an unseasonably warm winter across the northern-tier US and Great Lakes, dulling Q4 residential heating demand. | Sudden, volatile changes in European or Asian LNG supply networks. |

### Three “fluid” layers in the original deck

**Atmospheric fluid shocks (Super El Niño).** Ocean temperature anomalies in the Eastern Pacific approaching an unprecedented 4°C above average. Do not trade the average global forecast; look at the extremes — Australian wheat yield collapse (projected down up to 60%) and Vietnamese Robusta deficits.

**Network flow bottlenecks (Hormuz & logistics).** Treat global trade routes as a connected pipe system. Choking Hormuz pushes oil up, which spikes transpacific container rates and diesel. Physical ag commodities cost more to harvest and transport, inflating the floor of the longs.

**The “polycrisis” multiplier.** 1 + 1 = 3. Weather alone is manageable. A geopolitical chokepoint alone is manageable. When lower crop yields coincide with missing sulfur/phosphate from the Middle East, the supply curve snaps. Target commodities at the intersection.

### Fact-check of that deck

- ENSO: **real**, east-based. Niño 1+2 is +3.9°C. The 4°C claim is that region, not Niño 3.4 (+1.8°C).
- Hormuz: **real** (~10 ships/day) and **already priced** in oil/copper/nitrogen.
- Australian wheat −60%: **false**. ABARES: −17% YoY, still ~3% above the 10-year average; yields revised up after a wet winter.
- `JO`: **dead** since 14 Jun 2023.
- Short `UNG`: directionally consistent with NOAA’s warm northern-tier winter outlook, but **wrong payoff** at $2.9 HH / 57% vol after a 1y/2y decline, with Qatar LNG offline and JKM/TTF ~$24.

---

## Sources

- [NOAA CPC 8 Sep 2026 ENSO briefing](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/lanina/enso_evolution-status-fcsts-web.pdf)
- [Reuters Hormuz 7 Sep 2026](https://www.reuters.com/world/middle-east/hormuz-traffic-dips-lowest-since-may-after-us-iranian-strikes-ships-2026-09-06/)
- [Reuters oil 8 Sep 2026](https://www.reuters.com/business/energy/oil-rises-risks-prolonged-mideast-conflict-heighten-supply-worries-2026-09-08/)
- [ISO sugar](https://www.isosugar.org/prices.php?pricerange=last30) — ~18.5¢/lb on 4 Sep 2026
- [ABARES Sep 2026 crop report](https://www.agriculture.gov.au/abares/research-topics/agricultural-outlook/australian-crop-report/september-2026)
- [Macrobond ENSO / commodity cycles](https://www.macrobond.com/resources/macro-trends/el-nino-from-ocean-temperatures-to-economic-risk)
- Mapvest production `GET /v1/quote` and `GET /v1/quote-history` as of 2026-09-08T18:29Z

Situate/research packets are not built for these tickers (`GET /v1/situate/CANE` → 404). Exa MCP was rate-limited; Doppler is not mounted in this environment, so this used the live public API + NOAA/Reuters rather than a made-up tape.
