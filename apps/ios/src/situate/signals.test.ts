import { describe, expect, test } from "bun:test";
import type { SituatePacket } from "@/api/situate";
import {
  availableHorizons,
  businessRows,
  caveats,
  exposureBars,
  fanPoints,
  filingCards,
  levelRows,
  pickBaseRate,
  pickHorizon,
  pricedInRows,
  sectionError,
  sectionUnavailable,
  stateCells,
  zones,
} from "./signals";

function packet(overrides: Partial<SituatePacket> = {}): SituatePacket {
  return {
    ticker: "NVDA",
    as_of: "2026-09-01",
    generated_at: "2026-09-01T12:00:00.000Z",
    engine: "Situate",
    engine_version: "1.0.0",
    profile: { name: "NVIDIA Corp", sector: "Technology" },
    exposure: {
      basket: ["SPY", "SOXX", "DXY"],
      betas: { SPY: 1.31, SOXX: 0.72, DXY: -0.4 },
      se: { SPY: 0.08 },
      change_12m: { SPY: 0.14 },
      method: "ewma_ridge",
    },
    state: {
      spy: { vol_state: "low", trend_state: "up", cell: "low_up", realized_vol_21d: 0.11 },
      ticker: { vol_state: "high", trend_state: "up", cell: "high_up", realized_vol_21d: 0.34 },
      hmm: { probs: { bull: 0.62, neutral: 0.28, bear: 0.1 }, label: "bull" },
      context: { vix_pct: 0.41, hy_oas_pct: 0.22, curve_10y_2y: 0.35 },
    },
    base_rates: {
      by_horizon: {
        "3": {
          uncond: { q05: -0.18, q25: -0.05, q50: 0.03, q75: 0.11, q95: 0.27, n_eff: 84 },
          cond: { q50: 0.05, cell: "high_up", n_eff: 21 },
          shrunk: { q05: -0.16, q25: -0.04, q50: 0.036, q75: 0.1, q95: 0.25, w: 0.47, n_eff: 21 },
        },
      },
    },
    implied: {
      snapshot_ts: "2026-09-01T20:00:00.000Z",
      by_horizon: {
        "3": {
          expiry: "2026-12-19",
          iv_atm: 0.42,
          skew_25d: -0.03,
          quantiles: { q05: -0.22, q25: -0.07, q50: 0.01, q75: 0.09, q95: 0.28 },
          width_ratio_vs_hist: 1.18,
        },
      },
    },
    fundamentals: {
      momentum: { ret_12_1: 0.44, ret_1m_reversal: -0.03 },
      quality: { gp_to_assets: 0.51, net_debt_ebitda: -0.4, interest_cov: 58.2 },
      value_z: { ev_sales: 1.4, pe_fwd: 1.1, fcf_yield: -0.8, basis: "own_5y" },
      trajectory: [],
      revisions: null,
      pead: null,
      revisions_error: "no consensus-estimate provider",
      pead_error: "no consensus-estimate provider",
    },
    text: {
      filing_changes: [
        {
          section: "Item 1A Risk Factors",
          change_score: 0.31,
          new_risks: [{ text: "New export-control exposure", quote: "additional licensing" }],
          material_change_score: 3,
        },
      ],
      events: [{ date: "2026-08-28", type: "earnings", sentiment: "positive", headline: "Beat" }],
      exposure_flags: ["china_revenue"],
    },
    levels: {
      poc: 138.5,
      vah: 151.2,
      val: 122.9,
      ma20: 141.0,
      ma50: 133.4,
      ma200: 118.7,
      current_price: 140.0,
      cheap_zone: { price_lo: 120, price_hi: 128, horizon: "3" },
      rich_zone: { price_lo: 158, price_hi: 170, horizon: "3" },
    },
    stack: { published: false, reason: "insufficient breadth", configs_tried: 12 },
    odds: {
      version: "1.0.0",
      method: "base_rates+implied",
      stack_published: false,
      by_horizon: {
        "3": {
          source: "base_rates+implied",
          quantiles: { q05: -0.2, q25: -0.06, q50: 0.03, q75: 0.1, q95: 0.27 },
          p_up: 0.56,
          base_rate_q50: 0.03,
          shrink_w: 0.47,
        },
      },
    },
    scenarios: {
      bull: { state: "low_up", horizons: { "3": { quantile: 0.1, drivers: ["SPY"] } } },
      neutral: { state: "high_up", horizons: {} },
      bear: { state: "high_down", horizons: {} },
    },
    memo: {
      posture: { stance: "odds_favorable", horizon: "3m", conviction: 0.58, one_line: "x" },
    },
    sources: [],
    meta: {
      errors: [{ source: "stack", error: "insufficient breadth" }],
      unavailable: [{ source: "estimates", error: "no consensus-estimate provider" }],
      versions: { exposure: "1.0.0" },
    },
    ...overrides,
  } as SituatePacket;
}

describe("sectionError / sectionUnavailable", () => {
  test("prefers the *_error sibling, then the meta ledger", () => {
    const p = { ...packet(), stack: null, stack_error: "chain thin" } as unknown as SituatePacket;
    expect(sectionError(p, "stack")).toBe("chain thin");
  });

  test("falls back to meta.errors when no sibling", () => {
    const p = { ...packet(), stack: null } as SituatePacket;
    expect(sectionError(p, "stack")).toBe("insufficient breadth");
  });

  test("a present section is not unavailable; a null one names a reason", () => {
    const p = packet();
    expect(sectionUnavailable(p, "exposure", p.exposure)).toBeNull();
    const q = { ...packet(), implied: null } as SituatePacket;
    expect(sectionUnavailable(q, "implied", q.implied)).toBe(
      "the engine did not return this section",
    );
  });
});

describe("pickHorizon tolerates key spellings", () => {
  test("reads month-number, 'm' form, and integer keys", () => {
    expect(pickHorizon({ "3": 1 }, "3")).toBe(1);
    expect(pickHorizon({ "3m": 2 }, "3")).toBe(2);
    expect(pickHorizon(null, "3")).toBeNull();
    expect(pickHorizon({ "6": 9 }, "3")).toBeNull();
  });
});

describe("exposureBars", () => {
  test("orders by absolute beta and drops rows without a beta", () => {
    const bars = exposureBars(packet().exposure);
    expect(bars.map((b) => b.symbol)).toEqual(["SPY", "SOXX", "DXY"]);
    expect(bars[0]?.beta).toBe(1.31);
    expect(bars[0]?.change12m).toBe(0.14);
    expect(bars[2]?.tone).toBe("bear"); // DXY beta -0.4
  });

  test("empty when exposure is null", () => {
    expect(exposureBars(null)).toEqual([]);
  });
});

describe("stateCells", () => {
  test("returns the SPY and ticker cells with a trend tone", () => {
    const cells = stateCells(packet().state);
    expect(cells).toHaveLength(2);
    expect(cells[0]?.who).toBe("spy");
    expect(cells[0]?.tone).toBe("bull");
    expect(cells[1]?.realizedVol).toBe(0.34);
  });
});

describe("fanPoints", () => {
  test("merges base-rate, implied, and odds per horizon", () => {
    const fan = fanPoints(packet());
    expect(fan).toHaveLength(1);
    const p = fan[0];
    expect(p?.horizon).toBe("3");
    expect(p?.months).toBe(3);
    expect(p?.hist?.q50).toBe(0.036); // shrunk preferred over cond/uncond
    expect(p?.implied?.q50).toBe(0.01);
    expect(p?.odds?.q50).toBe(0.03);
    expect(p?.pUp).toBe(0.56);
    expect(p?.source).toBe("base_rates+implied");
    expect(p?.nEff).toBe(21); // carried from the shrunk base-rate distribution
  });

  test("reads odds through by_horizon, not a flat map", () => {
    // The engine wraps odds as {version, method, stack_published, by_horizon}.
    // A packet whose odds is only the wrapper (no matching horizon) yields no
    // odds quantiles — proving fanPoints does not read the wrapper keys flat.
    const p = packet({
      odds: { version: "1.0.0", method: "m", stack_published: false, by_horizon: {} },
    } as unknown as Partial<SituatePacket>);
    const fan = fanPoints(p);
    expect(fan[0]?.odds).toBeNull(); // base_rates/implied still populate hist/implied
    expect(fan[0]?.hist?.q50).toBe(0.036);
  });

  test("pickBaseRate prefers shrunk, then cond, then uncond", () => {
    expect(pickBaseRate(packet().base_rates?.by_horizon?.["3"] ?? null)?.basis).toBe("shrunk");
    expect(pickBaseRate({ cond: { q50: 0.05 }, uncond: { q50: 0.03 } })?.basis).toBe("cond");
    expect(pickBaseRate({ uncond: { q50: 0.03 } })?.basis).toBe("uncond");
    expect(pickBaseRate(null)).toBeNull();
  });

  test("availableHorizons reflects what the packet can speak to", () => {
    expect(availableHorizons(packet())).toEqual(["3"]);
  });
});

describe("pricedInRows", () => {
  test("reads width ratio + skew and writes a plain-language note", () => {
    const rows = pricedInRows(packet().implied);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.widthRatio).toBe(1.18);
    expect(rows[0]?.note).toContain("wider move");
  });
});

describe("businessRows", () => {
  test("emits the headline rows, dropping nulls, with sane tones", () => {
    const rows = businessRows(packet().fundamentals);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(byLabel["12-1 momentum"]?.value).toBe(0.44);
    expect(byLabel["12-1 momentum"]?.tone).toBe("bull");
    // Expensive valuation z (positive EV/sales z) reads bearish.
    expect(byLabel["EV / sales (z)"]?.tone).toBe("bear");
    // Low leverage (negative net debt/EBITDA) reads bullish.
    expect(byLabel["Net debt / EBITDA"]?.tone).toBe("bull");
  });

  test("filingCards keep only risks with text", () => {
    const cards = filingCards(packet().text?.filing_changes);
    expect(cards[0]?.newRisks).toHaveLength(1);
    expect(cards[0]?.newRisks[0]?.quote).toBe("additional licensing");
  });
});

describe("levels + zones", () => {
  test("levelRows carries distances from current and sorts high→low", () => {
    const rows = levelRows(packet().levels);
    expect(rows[0]?.kind).toBe("VAH");
    expect(rows[0]?.distance).toBeCloseTo(151.2 / 140 - 1, 6);
  });

  test("zones returns cheap and rich", () => {
    const z = zones(packet().levels);
    expect(z.map((x) => x.kind)).toEqual(["cheap", "rich"]);
    expect(z[0]?.lo).toBe(120);
  });
});

describe("caveats", () => {
  test("surfaces n_eff, shrink weight, gate status, and data gaps", () => {
    const rows = caveats(packet());
    const text = rows.map((r) => `${r.label}: ${r.value}`).join(" | ");
    expect(text).toContain("Effective sample (3m): 21 obs");
    // w=0.47 is the weight on the CONDITIONAL, so 53% is the pull toward the base rate.
    expect(text).toContain("53% toward the base rate");
    expect(text).toContain("not published — insufficient breadth");
    expect(text).toContain("no consensus-estimate provider");
  });
});
