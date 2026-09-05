import { describe, expect, test } from "bun:test";
import {
  DASH,
  clamp01,
  convictionLabel,
  fmtDate,
  fmtMoneyCompact,
  fmtMultiple,
  fmtPct,
  fmtPoints,
  fmtPrice,
  fmtSignedPct,
  fmtZ,
  horizonLabel,
  humanize,
  isPacketStale,
  isStance,
  postureHorizon,
  relativeAge,
  stanceLabel,
  stanceTone,
  toneForLabel,
  toneForValue,
  unavailableCopy,
} from "./format";

describe("number formatters treat null as unknown, never zero", () => {
  test("fmtPct / fmtSignedPct", () => {
    expect(fmtPct(0.0341)).toBe("3.4%");
    expect(fmtPct(null)).toBe(DASH);
    expect(fmtSignedPct(0.08)).toBe("+8.0%");
    expect(fmtSignedPct(-0.08)).toBe("−8.0%");
    expect(fmtSignedPct(0)).toBe("0.0%");
    expect(fmtSignedPct(undefined)).toBe(DASH);
  });

  test("fmtPoints / fmtPrice / fmtMoneyCompact", () => {
    expect(fmtPoints(0.42 * 100)).toBe("42.00%");
    expect(fmtPrice(138.52)).toBe("$138.52");
    expect(fmtPrice(1250)).toBe("$1,250");
    expect(fmtPrice(null)).toBe(DASH);
    expect(fmtMoneyCompact(1.24e12)).toBe("$1.24T");
    expect(fmtMoneyCompact(3.4e9)).toBe("$3.40B");
    expect(fmtMoneyCompact(null)).toBe(DASH);
  });

  test("fmtMultiple / fmtZ", () => {
    expect(fmtMultiple(1.18)).toBe("1.18×");
    expect(fmtMultiple(null)).toBe(DASH);
    expect(fmtZ(1.4)).toBe("+1.4σ");
    expect(fmtZ(-0.8)).toBe("−0.8σ");
    expect(fmtZ(null)).toBe(DASH);
  });
});

describe("posture grammar — never buy/sell", () => {
  test("stanceLabel / stanceTone", () => {
    expect(stanceLabel("odds_favorable")).toBe("Odds favorable");
    expect(stanceLabel("balanced")).toBe("Balanced");
    expect(stanceLabel("odds_unfavorable")).toBe("Odds unfavorable");
    expect(stanceLabel("buy")).toBe(DASH);
    expect(stanceTone("odds_favorable")).toBe("bull");
    expect(stanceTone("odds_unfavorable")).toBe("bear");
    expect(stanceTone("balanced")).toBe("neutral");
    expect(isStance("odds_favorable")).toBe(true);
    expect(isStance("strong_buy")).toBe(false);
  });

  test("convictionLabel bands", () => {
    expect(convictionLabel(0.9)).toBe("High conviction");
    expect(convictionLabel(0.6)).toBe("Moderate conviction");
    expect(convictionLabel(0.3)).toBe("Low conviction");
    expect(convictionLabel(0.1)).toBe("Very low conviction");
    expect(convictionLabel(null)).toBe("Conviction unstated");
  });
});

describe("tones + misc", () => {
  test("toneForLabel / toneForValue", () => {
    expect(toneForLabel("up")).toBe("bull");
    expect(toneForLabel("down")).toBe("bear");
    expect(toneForLabel("sideways")).toBe("neutral");
    expect(toneForValue(0.02)).toBe("bull");
    expect(toneForValue(-0.02)).toBe("bear");
    expect(toneForValue(null)).toBe("neutral");
  });

  test("humanize / horizonLabel", () => {
    expect(humanize("low_up")).toBe("Low up");
    expect(humanize("risk factors")).toBe("Risk factors");
    expect(humanize("")).toBe(DASH);
    expect(horizonLabel("3")).toBe("3M");
    expect(horizonLabel("18")).toBe("18M");
  });

  test("postureHorizon attaches a unit to the engine's bare integer", () => {
    // The engine emits posture.horizon as a number (6); it must not render "· 6".
    expect(postureHorizon(6)).toBe("6m");
    expect(postureHorizon("3m")).toBe("3m");
    expect(postureHorizon(null)).toBeNull();
    expect(postureHorizon("")).toBeNull();
  });

  test("clamp01", () => {
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
  });
});

describe("dates + staleness", () => {
  test("fmtDate parses by hand (no tz shift)", () => {
    expect(fmtDate("2026-09-01")).toBe("Sep 1, 2026");
    expect(fmtDate("garbage")).toBe(DASH);
  });

  test("relativeAge", () => {
    const now = Date.parse("2026-09-01T12:00:00Z");
    expect(relativeAge("2026-09-01T11:59:30Z", now)).toBe("just now");
    expect(relativeAge("2026-09-01T11:46:00Z", now)).toBe("14m ago");
    expect(relativeAge("2026-09-01T09:00:00Z", now)).toBe("3h ago");
    expect(relativeAge("2026-08-30T12:00:00Z", now)).toBe("2d ago");
  });

  test("isPacketStale after three days", () => {
    const now = Date.parse("2026-09-10T12:00:00Z");
    expect(isPacketStale("2026-09-09T12:00:00Z", now)).toBe(false);
    expect(isPacketStale("2026-09-01T12:00:00Z", now)).toBe(true);
    expect(isPacketStale(null, now)).toBe(false);
  });
});

describe("unavailableCopy names the reason", () => {
  test("lowercases a normal lead but not an acronym", () => {
    expect(unavailableCopy("the chain was too thin")).toBe("Unavailable: the chain was too thin");
    expect(unavailableCopy("SEC EDGAR timed out")).toBe("Unavailable: SEC EDGAR timed out");
    expect(unavailableCopy(null)).toBe("Unavailable: the engine did not return this section.");
  });
});
