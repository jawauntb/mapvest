import { describe, expect, test } from "bun:test";
import type { RatingResponse } from "@/api/client";
import { driverLine, ratingChipLabel, ratingTone, verdictChipLabel, worthALook } from "./rating";

const ok: RatingResponse = {
  ticker: "NVDA",
  status: "ok",
  rating: { action: "buy", strength: "normal", conviction: 0.72, one_line: "Buy · momentum" },
  probabilities: { strong_sell: 0.02, sell: 0.05, hold: 0.2, buy: 0.58, strong_buy: 0.15 },
  confidence: 0.72,
  drivers: [{ name: "momentum", direction: "up", weight: 0.64 }],
  evidence: [{ source: "quote", summary: "Price $100" }],
  inputs_used: ["quote", "ratios"],
  as_of: "2026-09-19T00:00:00.000Z",
  disclaimer: "AI-generated research signal, not investment advice.",
};

describe("rating chip copy", () => {
  test("BUY · 72% for an ok rating; null and muted when insufficient", () => {
    expect(ratingChipLabel(ok)).toBe("BUY · 72%");
    expect(ratingTone(ok)).toBe("up");
    const insufficient: RatingResponse = {
      ...ok,
      status: "insufficient_signal",
      rating: null,
      probabilities: null,
      confidence: 0,
    };
    expect(ratingChipLabel(insufficient)).toBeNull();
    expect(ratingTone(insufficient)).toBe("muted");
    expect(ratingTone({ ...ok, rating: { ...ok.rating!, action: "strong_sell" } })).toBe("down");
    expect(ratingTone({ ...ok, rating: { ...ok.rating!, action: "hold" } })).toBe("neutral");
  });

  test("driver rows carry the direction glyph and weight", () => {
    expect(driverLine({ name: "macro", direction: "down", weight: 0.56 })).toBe("Macro ↓ · 56%");
    expect(driverLine({ name: "peer_forecast", direction: "flat", weight: 0 })).toBe(
      "Peer forecast → · 0%",
    );
  });
});

describe("verdict chip copy", () => {
  test("parent / proxy / direct / none", () => {
    expect(
      verdictChipLabel(
        { exposure: "parent", probability: 0.88, worth_a_look: 0.8 },
        { ticker: "NKE" },
      ),
    ).toBe("Investable via parent · NKE · 88%");
    expect(
      verdictChipLabel({ exposure: "proxy", probability: 0.7, worth_a_look: 0.3 }, { etf: "XLY" }),
    ).toBe("Proxy exposure via XLY · 70%");
    expect(
      verdictChipLabel(
        { exposure: "direct", probability: 0.9, worth_a_look: 0.9 },
        { ticker: "NKE" },
      ),
    ).toBe("Direct · NKE · 90%");
    expect(verdictChipLabel({ exposure: "none", probability: 0.6, worth_a_look: 0.1 }, {})).toBe(
      "No public exposure · 60%",
    );
    expect(verdictChipLabel(undefined, { ticker: "NKE" })).toBeNull();
  });

  test("worthALook emphasizes at >= 0.7 unless there is no exposure", () => {
    expect(worthALook({ exposure: "parent", probability: 0.8, worth_a_look: 0.7 })).toBe(true);
    expect(worthALook({ exposure: "parent", probability: 0.8, worth_a_look: 0.69 })).toBe(false);
    expect(worthALook({ exposure: "none", probability: 0.8, worth_a_look: 0.9 })).toBe(false);
    expect(worthALook(undefined)).toBe(false);
  });
});
