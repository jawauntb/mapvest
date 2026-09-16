import { describe, expect, test } from "bun:test";
import {
  guestFindFromInvestable,
  mergeGuestFind,
  parseGuestJournal,
  toRecordFindInput,
} from "./guestFindJournal";

const nike = guestFindFromInvestable(
  {
    brand: { name: "Nike", isPublic: true, ticker: { symbol: "NKE" } },
    confidence: "high",
    quote: { price: 101 },
  },
  { createdAt: "2026-09-14T12:00:00.000Z" },
);

const privateLabel = guestFindFromInvestable(
  {
    brand: { name: "In-house", isPublic: false },
    comparables: [{ ticker: "SBUX" }],
    confidence: "medium",
    rarity: "rare",
  },
  { lat: 40.7, lng: -74, createdAt: "2026-09-15T12:00:00.000Z" },
);

describe("guestFindFromInvestable", () => {
  test("public brand keeps ticker; private brand keeps comparable", () => {
    expect(nike).toMatchObject({
      brand: "Nike",
      ticker: "NKE",
      isPublic: true,
      foundPrice: 101,
      createdAt: "2026-09-14T12:00:00.000Z",
    });
    expect(nike.comparable).toBeUndefined();
    expect(privateLabel).toMatchObject({
      brand: "In-house",
      isPublic: false,
      comparable: "SBUX",
      rarity: "rare",
      lat: 40.7,
      lng: -74,
    });
    expect(privateLabel.ticker).toBeUndefined();
  });
});

describe("mergeGuestFind", () => {
  test("keeps the first catch per identity and prepends new brands", () => {
    const recatch = { ...nike, createdAt: "2026-09-15T18:00:00.000Z", foundPrice: 110 };
    const afterRecatch = mergeGuestFind([nike], recatch);
    expect(afterRecatch).toEqual([nike]);

    const both = mergeGuestFind([nike], privateLabel);
    expect(both.map((f) => f.brand)).toEqual(["In-house", "Nike"]);
  });
});

describe("parseGuestJournal / toRecordFindInput", () => {
  test("drops corrupt storage and strips rarity for the wire", () => {
    expect(parseGuestJournal(null)).toEqual([]);
    expect(parseGuestJournal("{")).toEqual([]);
    expect(parseGuestJournal(JSON.stringify([privateLabel, { brand: 1 }]))).toEqual([privateLabel]);
    expect(toRecordFindInput(privateLabel)).toEqual({
      brand: "In-house",
      ticker: undefined,
      isPublic: false,
      comparable: "SBUX",
      confidence: "medium",
      lat: 40.7,
      lng: -74,
      foundPrice: undefined,
      createdAt: "2026-09-15T12:00:00.000Z",
    });
  });
});
