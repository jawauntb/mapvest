import { describe, expect, test } from "bun:test";
import {
  DASH,
  clamp01,
  convictionLabel,
  fmtCount,
  fmtDate,
  fmtMoneyCompact,
  fmtMonth,
  fmtMultiple,
  fmtNumber,
  fmtPct,
  fmtPoints,
  fmtPrice,
  fmtSignedPct,
  horizonLabel,
  humanize,
  isPacketStale,
  isRecommendationAction,
  recommendationLabel,
  recommendationTone,
  relativeAge,
  sectionError,
  sectionUnavailable,
  toneForLabel,
  toneForValue,
  unavailableCopy,
} from "./format";

describe("number formatting", () => {
  test("decimal fractions render as percent", () => {
    expect(fmtPct(0.0341)).toBe("3.4%");
    expect(fmtPct(-0.12, 2)).toBe("-12.00%");
    expect(fmtPct(0)).toBe("0.0%");
  });

  test("null / NaN never become a number", () => {
    expect(fmtPct(null)).toBe(DASH);
    expect(fmtPct(undefined)).toBe(DASH);
    expect(fmtPct(Number.NaN)).toBe(DASH);
    expect(fmtPct("0.5")).toBe(DASH);
    expect(fmtPrice(null)).toBe(DASH);
    expect(fmtMoneyCompact(null)).toBe(DASH);
    expect(fmtNumber(Number.POSITIVE_INFINITY)).toBe(DASH);
    expect(fmtMultiple(null)).toBe(DASH);
    expect(fmtCount(null)).toBe(DASH);
  });

  test("signed percent uses a real minus sign and marks zero as flat", () => {
    expect(fmtSignedPct(0.052)).toBe("+5.2%");
    expect(fmtSignedPct(-0.052)).toBe("−5.2%");
    expect(fmtSignedPct(0)).toBe("0.0%");
  });

  test("prices scale their precision with magnitude", () => {
    expect(fmtPrice(1234.5)).toBe("$1,235");
    expect(fmtPrice(184.27)).toBe("$184.27");
    expect(fmtPrice(4.1234)).toBe("$4.123");
  });

  test("compact money covers trillions down to dollars", () => {
    expect(fmtMoneyCompact(4.41e12)).toBe("$4.41T");
    expect(fmtMoneyCompact(3.2e9)).toBe("$3.20B");
    expect(fmtMoneyCompact(-8.5e6)).toBe("−$8.5M");
    expect(fmtMoneyCompact(920)).toBe("$920");
  });

  test("points keep their own unit", () => {
    expect(fmtPoints(4.312)).toBe("4.31%");
    expect(fmtPoints(17.4, 1, "")).toBe("17.4");
  });

  test("multiples and counts", () => {
    expect(fmtMultiple(24.13)).toBe("24.1×");
    expect(fmtCount(12345)).toBe("12,345");
  });
});

describe("vocabulary", () => {
  test("humanize turns engine keys into sentence case", () => {
    expect(humanize("strong_buy")).toBe("Strong buy");
    expect(humanize("risk-factors")).toBe("Risk factors");
    expect(humanize("")).toBe(DASH);
    expect(humanize(null)).toBe(DASH);
  });

  test("recommendation grammar maps to labels and tones", () => {
    expect(recommendationLabel("strong_buy")).toBe("Strong buy");
    expect(recommendationLabel("nope")).toBe(DASH);
    expect(recommendationTone("strong_sell")).toBe("bear");
    expect(recommendationTone("hold")).toBe("neutral");
    expect(recommendationTone(undefined)).toBe("neutral");
    expect(isRecommendationAction("buy")).toBe(true);
    expect(isRecommendationAction("BUY")).toBe(false);
  });

  test("conviction bands", () => {
    expect(convictionLabel(0.81)).toBe("High conviction");
    expect(convictionLabel(0.5)).toBe("Moderate conviction");
    expect(convictionLabel(0.3)).toBe("Low conviction");
    expect(convictionLabel(0.1)).toBe("Very low conviction");
    expect(convictionLabel(null)).toBe("Conviction unstated");
  });

  test("tones from labels and signed values", () => {
    expect(toneForLabel("bull")).toBe("bull");
    expect(toneForLabel("decelerating")).toBe("bear");
    expect(toneForLabel("whatever")).toBe("neutral");
    expect(toneForValue(0.01)).toBe("bull");
    expect(toneForValue(-0.01)).toBe("bear");
    expect(toneForValue(0.005, 0.01)).toBe("neutral");
    expect(toneForValue(null)).toBe("neutral");
  });

  test("horizon labels are the screaming form", () => {
    expect(horizonLabel("18m")).toBe("18M");
  });
});

describe("dates", () => {
  test("ISO dates format without a timezone shift", () => {
    expect(fmtDate("2026-09-01")).toBe("Sep 1, 2026");
    expect(fmtDate("2026-01-31T23:00:00Z")).toBe("Jan 31, 2026");
    expect(fmtDate("nope")).toBe(DASH);
  });

  test("month labels", () => {
    expect(fmtMonth("2026-09")).toBe("Sep '26");
    expect(fmtMonth("2025-12-04")).toBe("Dec '25");
    expect(fmtMonth(null)).toBe(DASH);
  });

  test("relative age steps through minutes, hours, days, then a date", () => {
    const now = Date.parse("2026-09-01T12:00:00Z");
    expect(relativeAge("2026-09-01T11:59:30Z", now)).toBe("just now");
    expect(relativeAge("2026-09-01T11:46:00Z", now)).toBe("14m ago");
    expect(relativeAge("2026-09-01T09:00:00Z", now)).toBe("3h ago");
    expect(relativeAge("2026-08-30T12:00:00Z", now)).toBe("2d ago");
    expect(relativeAge("2026-07-01T12:00:00Z", now)).toBe("Jul 1, 2026");
    expect(relativeAge("garbage", now)).toBe(DASH);
  });
});

describe("null sections", () => {
  const packet = {
    seasonality_error: "Massive returned fewer than 2 years of bars",
    meta: { errors: [{ source: "filings", error: "SEC EDGAR timed out" }] },
  };

  test("prefers the section's own error sibling", () => {
    expect(sectionError(packet, "seasonality")).toBe("Massive returned fewer than 2 years of bars");
  });

  test("falls back to the meta error ledger", () => {
    expect(sectionError(packet, "filings")).toBe("SEC EDGAR timed out");
  });

  test("returns null when the engine said nothing", () => {
    expect(sectionError(packet, "macro")).toBeNull();
  });

  test("sectionUnavailable answers only for absent sections", () => {
    expect(sectionUnavailable(packet, "seasonality", { month: 9 })).toBeNull();
    expect(sectionUnavailable(packet, "seasonality", null)).toBe(
      "Massive returned fewer than 2 years of bars",
    );
    expect(sectionUnavailable(packet, "macro", null)).toBe(
      "the engine did not return this section",
    );
  });

  test("unavailable copy always names a reason", () => {
    expect(unavailableCopy("Massive returned 403")).toBe("Unavailable: massive returned 403");
    // Acronyms keep their case — "sEC EDGAR timed out" would be nonsense.
    expect(unavailableCopy("SEC EDGAR timed out")).toBe("Unavailable: SEC EDGAR timed out");
    expect(unavailableCopy(null)).toBe("Unavailable: the engine did not return this section.");
    expect(unavailableCopy("   ")).toBe("Unavailable: the engine did not return this section.");
  });
});

test("clamp01", () => {
  expect(clamp01(-3)).toBe(0);
  expect(clamp01(0.4)).toBe(0.4);
  expect(clamp01(9)).toBe(1);
  expect(clamp01(Number.NaN)).toBe(0);
});

describe("isPacketStale", () => {
  const now = Date.parse("2026-09-02T00:00:00Z");

  test("a fresh packet is not stale", () => {
    expect(isPacketStale("2026-09-01T23:00:00Z", now)).toBe(false);
    expect(isPacketStale("2026-08-30T12:00:00Z", now)).toBe(false);
  });

  test("a packet older than the window is stale — its prices are that day's close", () => {
    expect(isPacketStale("2026-08-29T00:00:00Z", now)).toBe(true);
    expect(isPacketStale("2026-08-01T00:00:00Z", now)).toBe(true);
  });

  test("an unknown build time never fabricates a warning", () => {
    expect(isPacketStale(undefined, now)).toBe(false);
    expect(isPacketStale(null, now)).toBe(false);
    expect(isPacketStale("not a date", now)).toBe(false);
  });

  test("the window is caller-adjustable", () => {
    expect(isPacketStale("2026-09-01T00:00:00Z", now, 60_000)).toBe(true);
  });
});
