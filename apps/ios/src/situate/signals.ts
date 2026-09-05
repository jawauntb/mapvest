/**
 * Pure packet → view-model derivations for the Situate dashboard.
 *
 * Every function here is a pure function of the packet (or a section of it) and
 * returns plain data the section components and charts render. No react-native,
 * no `@/` runtime import — only `import type` from the API client, which is
 * erased at compile time — so `bun test apps/ios/src/situate` covers all of it.
 *
 * The two contract rules are enforced here so no component has to think about
 * them: a `null` section is "could not compute" (never zero), and a missing
 * quantile stays `null` rather than becoming 0.
 */
import type {
  SituateBaseRateDist,
  SituateExposure,
  SituateFilingChange,
  SituateFundamentals,
  SituateImplied,
  SituateLevels,
  SituateOddsHorizon,
  SituatePacket,
  SituateSectionKey,
  SituateState,
} from "@/api/situate";
import { SITUATE_HORIZONS, SITUATE_HORIZON_MONTHS, type SituateHorizonKey } from "./constants";
import type { Tone } from "./format";

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// -------- "unavailable: reason" --------

/**
 * Why a section is `null`. The engine writes a `<section>_error` sibling on the
 * packet and also appends to `meta.errors`; we prefer the sibling and fall back
 * to the ledger, so a section never silently renders as empty.
 */
export function sectionError(
  packet: Pick<SituatePacket, "meta"> & { [k: string]: unknown },
  key: SituateSectionKey,
): string | null {
  const sibling = packet[`${key}_error`];
  if (typeof sibling === "string" && sibling.trim()) return sibling.trim();
  const errors = packet.meta?.errors ?? [];
  for (const entry of errors) {
    if (entry && entry.source === key && typeof entry.error === "string" && entry.error.trim()) {
      return entry.error.trim();
    }
  }
  return null;
}

/**
 * The reason string a section card should render, or `null` when the section is
 * present. Collapses the two-step "is it null / why is it null" into one call.
 */
export function sectionUnavailable(
  packet: Pick<SituatePacket, "meta"> & { [k: string]: unknown },
  key: SituateSectionKey,
  section: unknown,
): string | null {
  if (section !== null && section !== undefined) return null;
  return sectionError(packet, key) ?? "the engine did not return this section";
}

// -------- horizon lookup (robust to key spelling) --------

/**
 * Reads a `by_horizon`-style record for one horizon, tolerant of how the engine
 * spelled the key: the month number ("3"), the "3m" form, or a stray integer.
 */
export function pickHorizon<T>(
  record: Record<string, T | null> | null | undefined,
  key: SituateHorizonKey,
): T | null {
  if (!record) return null;
  const months = SITUATE_HORIZON_MONTHS[key];
  const candidates = [key, `${key}m`, String(months), `${months}m`];
  for (const candidate of candidates) {
    const hit = record[candidate];
    if (hit !== undefined && hit !== null) return hit;
  }
  return null;
}

/** The horizons the packet actually has data for, in any of the merged blocks. */
export function availableHorizons(packet: SituatePacket): SituateHorizonKey[] {
  return SITUATE_HORIZONS.filter(
    (h) =>
      pickHorizon(packet.odds?.by_horizon ?? null, h) !== null ||
      pickHorizon(packet.base_rates?.by_horizon ?? null, h) !== null ||
      pickHorizon(packet.implied?.by_horizon ?? null, h) !== null,
  );
}

// -------- exposure (SPEC 5.1) --------

export type ExposureBar = {
  symbol: string;
  /** Always finite — `exposureBars` drops any row without a beta. */
  beta: number;
  se: number | null;
  change12m: number | null;
  change6m: number | null;
  tone: Tone;
};

/**
 * The basket, ordered by absolute beta, each with its 12-month change. A
 * missing beta drops the row — an exposure bar with no bar is noise.
 */
export function exposureBars(exposure: SituateExposure | null | undefined): ExposureBar[] {
  if (!exposure) return [];
  const betas = exposure.betas ?? {};
  const basket =
    exposure.basket && exposure.basket.length > 0 ? exposure.basket : Object.keys(betas);
  const rows: ExposureBar[] = [];
  for (const symbol of basket) {
    const beta = num(betas[symbol]);
    if (beta === null) continue;
    rows.push({
      symbol,
      beta,
      se: num(exposure.se?.[symbol]),
      change12m: num(exposure.change_12m?.[symbol]),
      change6m: num(exposure.change_6m?.[symbol]),
      tone: beta > 0 ? "bull" : beta < 0 ? "bear" : "neutral",
    });
  }
  return rows.sort((a, b) => Math.abs(b.beta) - Math.abs(a.beta));
}

// -------- state (SPEC 5.2) --------

export type StateCellView = {
  who: "spy" | "ticker";
  label: string;
  cell: string | null;
  volState: string | null;
  trendState: string | null;
  realizedVol: number | null;
  tone: Tone;
};

/** The 2×2 grid data for SPY and the ticker. */
export function stateCells(state: SituateState | null | undefined): StateCellView[] {
  if (!state) return [];
  const out: StateCellView[] = [];
  const add = (who: "spy" | "ticker", label: string) => {
    const cell = state[who];
    if (!cell) return;
    const trend = cell.trend_state ?? null;
    out.push({
      who,
      label,
      cell: cell.cell ?? null,
      volState: cell.vol_state ?? null,
      trendState: trend,
      realizedVol: num(cell.realized_vol_21d),
      tone: trend === "up" ? "bull" : trend === "down" ? "bear" : "neutral",
    });
  };
  add("spy", "SPY");
  add("ticker", "Ticker");
  return out;
}

// -------- odds + implied fan (SPEC 5.3 / 5.4, merged) --------

export type QuantileSet = {
  q05: number | null;
  q25: number | null;
  q50: number | null;
  q75: number | null;
  q95: number | null;
};

function quantiles(
  src:
    | {
        q05?: number | null;
        q25?: number | null;
        q50?: number | null;
        q75?: number | null;
        q95?: number | null;
      }
    | null
    | undefined,
): QuantileSet | null {
  if (!src) return null;
  const q: QuantileSet = {
    q05: num(src.q05),
    q25: num(src.q25),
    q50: num(src.q50),
    q75: num(src.q75),
    q95: num(src.q95),
  };
  // A set with no median and no band is not a distribution.
  if (q.q05 === null && q.q25 === null && q.q50 === null && q.q75 === null && q.q95 === null) {
    return null;
  }
  return q;
}

/** Base-rate distribution to plot as "historical": shrunk, else conditional, else unconditional. */
export function pickBaseRate(
  horizon: {
    shrunk?: SituateBaseRateDist | null;
    cond?: SituateBaseRateDist | null;
    uncond?: SituateBaseRateDist | null;
  } | null,
): { dist: SituateBaseRateDist; basis: "shrunk" | "cond" | "uncond" } | null {
  if (!horizon) return null;
  if (horizon.shrunk && quantiles(horizon.shrunk)) return { dist: horizon.shrunk, basis: "shrunk" };
  if (horizon.cond && quantiles(horizon.cond)) return { dist: horizon.cond, basis: "cond" };
  if (horizon.uncond && quantiles(horizon.uncond)) return { dist: horizon.uncond, basis: "uncond" };
  return null;
}

export type FanPoint = {
  horizon: SituateHorizonKey;
  months: number;
  /** The empirical base-rate distribution ("historical"). */
  hist: QuantileSet | null;
  /** The options-implied distribution. */
  implied: QuantileSet | null;
  /** The merged distribution the memo reads. */
  odds: QuantileSet | null;
  pUp: number | null;
  source: string | null;
  baseRateQ50: number | null;
  shrinkW: number | null;
  /** Effective sample behind the base-rate distribution (n/h); gates small-n hedges. */
  nEff: number | null;
};

/**
 * One row per horizon the packet can speak to, spaced by months on the x-axis
 * so the band's widening over time is real and not an artefact of equal slots.
 */
export function fanPoints(packet: SituatePacket): FanPoint[] {
  const out: FanPoint[] = [];
  for (const h of SITUATE_HORIZONS) {
    const odds = pickHorizon(packet.odds?.by_horizon ?? null, h) as SituateOddsHorizon | null;
    const implied = pickHorizon(packet.implied?.by_horizon ?? null, h);
    const base = pickHorizon(packet.base_rates?.by_horizon ?? null, h);
    const baseDist = pickBaseRate(base);
    if (!odds && !implied && !baseDist) continue;
    out.push({
      horizon: h,
      months: SITUATE_HORIZON_MONTHS[h],
      hist: baseDist ? quantiles(baseDist.dist) : null,
      implied: implied ? quantiles(implied.quantiles) : null,
      odds: odds ? quantiles(odds.quantiles) : null,
      pUp: num(odds?.p_up),
      source: odds?.source ?? null,
      baseRateQ50: num(odds?.base_rate_q50) ?? (baseDist ? num(baseDist.dist.q50) : null),
      shrinkW: num(odds?.shrink_w),
      nEff: num(base?.shrunk?.n_eff) ?? num(base?.cond?.n_eff) ?? num(base?.uncond?.n_eff),
    });
  }
  return out;
}

// -------- what's priced in (SPEC 5.4) --------

export type PricedInRow = {
  horizon: SituateHorizonKey;
  widthRatio: number | null;
  skew25d: number | null;
  ivAtm: number | null;
  /** Words the panel reads for the disagreement. */
  note: string;
};

/**
 * The options-vs-history disagreement per horizon: `width_ratio` (implied band
 * over the historical conditional band) and 25Δ skew. `null` inputs stay null.
 */
export function pricedInRows(implied: SituateImplied | null | undefined): PricedInRow[] {
  const byH = implied?.by_horizon;
  if (!byH) return [];
  const rows: PricedInRow[] = [];
  for (const h of SITUATE_HORIZONS) {
    const entry = pickHorizon(byH, h);
    if (!entry) continue;
    const wr = num(entry.width_ratio_vs_hist);
    const skew = num(entry.skew_25d);
    if (wr === null && skew === null && num(entry.iv_atm) === null) continue;
    let note = "";
    if (wr !== null) {
      note =
        wr > 1.15
          ? "Options price a wider move than history"
          : wr < 0.85
            ? "Options price a tighter move than history"
            : "Options and history roughly agree on width";
    }
    rows.push({
      horizon: h,
      widthRatio: wr,
      skew25d: skew,
      ivAtm: num(entry.iv_atm),
      note,
    });
  }
  return rows;
}

// -------- business (SPEC 5.5) --------

export type BusinessRow = {
  label: string;
  value: number | null;
  tone: Tone;
  kind: "pct" | "z" | "x" | "num";
};

/**
 * The fundamentals headline rows. Revisions and PEAD are deliberately absent —
 * they are `null` in the packet (Massive has no estimates endpoint) and the
 * section renders that as a stated data gap, not as a zero here.
 */
export function businessRows(f: SituateFundamentals | null | undefined): BusinessRow[] {
  if (!f) return [];
  const rows: BusinessRow[] = [];
  const push = (label: string, value: number | null, kind: BusinessRow["kind"], tone: Tone) => {
    if (value === null) return;
    rows.push({ label, value, kind, tone });
  };
  push("12-1 momentum", num(f.momentum?.ret_12_1), "pct", toneOf(num(f.momentum?.ret_12_1)));
  push(
    "1m reversal",
    num(f.momentum?.ret_1m_reversal),
    "pct",
    toneOf(num(f.momentum?.ret_1m_reversal)),
  );
  push(
    "Gross profit / assets",
    num(f.quality?.gp_to_assets),
    "num",
    toneOf(num(f.quality?.gp_to_assets)),
  );
  push(
    "Net debt / EBITDA",
    num(f.quality?.net_debt_ebitda),
    "x",
    toneOf(num(f.quality?.net_debt_ebitda), 0, true),
  );
  push(
    "Interest coverage",
    num(f.quality?.interest_cov),
    "x",
    toneOf(num(f.quality?.interest_cov)),
  );
  push("EV / sales (z)", num(f.value_z?.ev_sales), "z", toneOf(num(f.value_z?.ev_sales), 0, true));
  push("Fwd P/E (z)", num(f.value_z?.pe_fwd), "z", toneOf(num(f.value_z?.pe_fwd), 0, true));
  push("FCF yield (z)", num(f.value_z?.fcf_yield), "z", toneOf(num(f.value_z?.fcf_yield)));
  return rows;
}

function toneOf(v: number | null, deadband = 0, invert = false): Tone {
  if (v === null) return "neutral";
  const positive = v > deadband;
  const negative = v < -deadband;
  if (invert) return positive ? "bear" : negative ? "bull" : "neutral";
  return positive ? "bull" : negative ? "bear" : "neutral";
}

export type FilingCardView = {
  section: string;
  changeScore: number | null;
  materialScore: number | null;
  newRisks: { text: string; quote: string | null }[];
};

/** Filing-diff cards with their quoted evidence; empty risks stay empty. */
export function filingCards(changes: SituateFilingChange[] | null | undefined): FilingCardView[] {
  if (!changes) return [];
  return changes.map((c) => ({
    section: c.section ?? "Filing section",
    changeScore: num(c.change_score),
    materialScore: num(c.material_change_score),
    newRisks: (c.new_risks ?? [])
      .map((r) => ({ text: r.text ?? "", quote: r.quote ?? null }))
      .filter((r) => r.text.trim().length > 0),
  }));
}

// -------- levels + zones (SPEC 5.8) --------

export type LevelRow = { kind: string; price: number; distance: number | null };

/**
 * The price ladder: every published level plus the moving averages, each with
 * its distance from the current price when we have one.
 */
export function levelRows(levels: SituateLevels | null | undefined): LevelRow[] {
  if (!levels) return [];
  const current = num(levels.current_price);
  const rows: LevelRow[] = [];
  const add = (kind: string, value: unknown) => {
    const price = num(value);
    if (price === null) return;
    rows.push({ kind, price, distance: current === null ? null : price / current - 1 });
  };
  add("VAH", levels.vah);
  add("POC", levels.poc);
  add("VAL", levels.val);
  add("MA20", levels.ma20);
  add("MA50", levels.ma50);
  add("MA200", levels.ma200);
  return rows.sort((a, b) => b.price - a.price);
}

export type ZoneView = {
  kind: "cheap" | "rich";
  lo: number | null;
  hi: number | null;
  horizon: string | null;
};

/** Cheap/rich zones = the price at the 25th/75th implied quantile at 3 & 6m. */
export function zones(levels: SituateLevels | null | undefined): ZoneView[] {
  if (!levels) return [];
  const out: ZoneView[] = [];
  if (levels.cheap_zone) {
    out.push({
      kind: "cheap",
      lo: num(levels.cheap_zone.price_lo),
      hi: num(levels.cheap_zone.price_hi),
      horizon: levels.cheap_zone.horizon ?? null,
    });
  }
  if (levels.rich_zone) {
    out.push({
      kind: "rich",
      lo: num(levels.rich_zone.price_lo),
      hi: num(levels.rich_zone.price_hi),
      horizon: levels.rich_zone.horizon ?? null,
    });
  }
  return out;
}

// -------- confidence / caveats (SPEC 6.9) --------

export type Caveat = { label: string; value: string };

/**
 * The honesty rows: effective sample sizes, shrink weights, whether the
 * cross-sectional stack published, and any stated data gaps. This is what makes
 * the memo answerable instead of oracular.
 */
export function caveats(packet: SituatePacket): Caveat[] {
  const rows: Caveat[] = [];

  // Effective sample + shrink at the posture horizon (or the shortest we have).
  const fan = fanPoints(packet);
  const first = fan[0];
  if (first) {
    const base = pickHorizon(packet.base_rates?.by_horizon ?? null, first.horizon);
    const nEff = num(base?.shrunk?.n_eff) ?? num(base?.cond?.n_eff) ?? num(base?.uncond?.n_eff);
    if (nEff !== null) {
      rows.push({
        label: `Effective sample (${first.horizon}m)`,
        value: `${Math.round(nEff)} obs`,
      });
    }
    // `w` is the weight on the CONDITIONAL estimate (shrunk = w·cond +
    // (1−w)·uncond), so the share pulled toward the unconditional base rate is
    // its complement. w=0.16 ⇒ "84% toward the base rate", matching the memo.
    const w = first.shrinkW ?? num(base?.shrunk?.w);
    if (w !== null) {
      rows.push({
        label: "Shrink weight",
        value: `${((1 - w) * 100).toFixed(0)}% toward the base rate`,
      });
    }
  }

  // Stack gate status.
  const stack = packet.stack;
  if (stack) {
    if (stack.published === true) {
      rows.push({ label: "Cross-sectional stack", value: "published (gates passed)" });
    } else {
      rows.push({
        label: "Cross-sectional stack",
        value: stack.reason
          ? `not published — ${stack.reason}`
          : "not published; odds use base rates + implied",
      });
    }
  }

  // Stated data gaps: revisions/PEAD always, plus any meta.unavailable.
  const gaps = new Set<string>();
  const f = packet.fundamentals;
  if (f) {
    if (f.revisions_error) gaps.add(f.revisions_error);
    if (f.pead_error) gaps.add(f.pead_error);
  }
  for (const u of packet.meta?.unavailable ?? []) {
    const reason =
      typeof u?.error === "string" ? u.error : typeof u?.reason === "string" ? u.reason : null;
    const source = typeof u?.source === "string" ? u.source : null;
    if (reason) gaps.add(source ? `${source}: ${reason}` : reason);
  }
  for (const gap of gaps) rows.push({ label: "Data gap", value: gap });

  return rows;
}
