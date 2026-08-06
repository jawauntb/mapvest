import { beforeEach, describe, expect, test } from "bun:test";
import {
  attachWatchMemo,
  listWatchEntries,
  removeWatchEntry,
  upsertWatchEntry,
} from "../src/lib/watchlist-store.js";

/**
 * In-memory path only (POSTGRES_URL unset in test env). Covers the add →
 * list → memo → remove contract that Saved depends on.
 */
describe("watchlist-store (in-memory)", () => {
  const userId = `u_wl_${Math.random().toString(36).slice(2)}`;

  beforeEach(async () => {
    // Isolate each test user — store keys by userId so no shared wipe needed.
  });

  test("upsert then list returns the ticker", async () => {
    await upsertWatchEntry(userId, {
      ticker: "aapl",
      name: "Apple Inc.",
      sector: "Technology",
      source: "detail",
    });
    const items = await listWatchEntries(userId);
    expect(items.some((e) => e.ticker === "AAPL")).toBe(true);
    const apple = items.find((e) => e.ticker === "AAPL")!;
    expect(apple.name).toBe("Apple Inc.");
    expect(apple.source).toBe("detail");
  });

  test("re-upsert preserves createdAt and can attach a memo", async () => {
    const uid = `${userId}_memo`;
    const first = await upsertWatchEntry(uid, {
      ticker: "SBUX",
      name: "Starbucks",
      source: "detail",
    });
    const again = await upsertWatchEntry(uid, {
      ticker: "SBUX",
      name: "Starbucks Corp",
      source: "camera",
    });
    expect(again.createdAt).toBe(first.createdAt);
    expect(again.name).toBe("Starbucks Corp");

    const withMemo = await attachWatchMemo(
      uid,
      "SBUX",
      "A longer investment memo about Starbucks that clears the min length.",
      "test",
    );
    expect(withMemo?.memoProvider).toBe("test");
    expect(withMemo?.memo?.length).toBeGreaterThan(20);
  });

  test("remove drops the ticker from the list", async () => {
    const uid = `${userId}_rm`;
    await upsertWatchEntry(uid, { ticker: "JPM", source: "manual" });
    expect(await removeWatchEntry(uid, "JPM")).toBe(true);
    const items = await listWatchEntries(uid);
    expect(items.some((e) => e.ticker === "JPM")).toBe(false);
  });
});
