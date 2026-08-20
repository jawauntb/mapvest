import { describe, expect, test } from "bun:test";
import { parseEdgePicks } from "../src/valueChain.js";

/**
 * Pure-parser coverage for the value-chain judge payload (offline, no network).
 * The judge is free-form text under a json_object hint — the parser has to
 * survive fences, prose and outright garbage without throwing.
 */
describe("parseEdgePicks", () => {
  test("parses clean JSON", () => {
    const raw = JSON.stringify({
      edges: [
        {
          counterparty: "Taiwan Semiconductor Manufacturing",
          ticker: "TSM",
          relation: "supplies",
          weight: 0.9,
          reasoning: "Sole foundry for leading-edge GPUs.",
          sourceUrl: "https://example.com/tsmc",
        },
        {
          counterparty: "Microsoft",
          ticker: "MSFT",
          relation: "buys_from",
          weight: 0.8,
          reasoning: "Hyperscaler capex is a >10% customer.",
        },
      ],
    });
    const picks = parseEdgePicks(raw);
    expect(picks.length).toBe(2);
    expect(picks[0]?.ticker).toBe("TSM");
    expect(picks[0]?.relation).toBe("supplies");
    expect(picks[0]?.sourceUrl).toBe("https://example.com/tsmc");
    expect(picks[1]?.relation).toBe("buys_from");
    expect(picks[1]?.sourceUrl).toBeUndefined();
  });

  test("strips ```json code fences", () => {
    const raw =
      '```json\n{"edges":[{"counterparty":"SK Hynix","relation":"supplies","weight":0.7,"reasoning":"HBM supplier"}]}\n```';
    const picks = parseEdgePicks(raw);
    expect(picks.length).toBe(1);
    expect(picks[0]?.counterparty).toBe("SK Hynix");
    expect(picks[0]?.ticker).toBeUndefined();
    expect(picks[0]?.weight).toBe(0.7);
  });

  test("slices the object out of prose-wrapped output", () => {
    const raw = `Here is what the evidence supports:
{"edges":[{"counterparty":"Advanced Micro Devices","ticker":"AMD","relation":"competes_with","weight":0.6,"reasoning":"Direct GPU competitor"}]}
Let me know if you need more.`;
    const picks = parseEdgePicks(raw);
    expect(picks.length).toBe(1);
    expect(picks[0]?.ticker).toBe("AMD");
    expect(picks[0]?.relation).toBe("competes_with");
  });

  test("returns [] for malformed or empty payloads", () => {
    expect(parseEdgePicks("not json at all")).toEqual([]);
    expect(parseEdgePicks('{"edges": [')).toEqual([]);
    expect(parseEdgePicks("")).toEqual([]);
    expect(parseEdgePicks("{}")).toEqual([]);
    expect(parseEdgePicks('{"edges": "nope"}')).toEqual([]);
  });

  test("drops entries missing counterparty or relation, clamps weight, caps at 12", () => {
    const picks = parseEdgePicks(
      JSON.stringify({
        edges: [
          { counterparty: "", relation: "supplies", weight: 0.5, reasoning: "x" },
          { counterparty: "Foxconn", relation: "", weight: 0.5, reasoning: "x" },
          { counterparty: "Foxconn", relation: "supplies", weight: 4.2, reasoning: "x" },
          { counterparty: "Corning", relation: "supplies", weight: "oops", reasoning: "x" },
          ...Array.from({ length: 14 }, (_, i) => ({
            counterparty: `Vendor ${i}`,
            relation: "supplies",
            weight: 0.4,
            reasoning: "bulk",
          })),
        ],
      }),
    );
    expect(picks.length).toBe(12);
    expect(picks[0]?.counterparty).toBe("Foxconn");
    expect(picks[0]?.weight).toBe(1);
    expect(picks[1]?.counterparty).toBe("Corning");
    expect(picks[1]?.weight).toBe(0.5);
  });
});
