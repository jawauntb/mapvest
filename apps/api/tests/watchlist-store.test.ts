import { beforeEach, describe, expect, test } from "bun:test";
import {
  attachWatchMemo,
  createWatchList,
  deleteWatchList,
  ensureDefaultList,
  listWatchEntries,
  listWatchLists,
  removeWatchEntry,
  setDefaultWatchList,
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

  test("setDefaultWatchList promotes a list and demotes the old default", async () => {
    const uid = `${userId}_default`;
    const original = await ensureDefaultList(uid);
    const nypc = await createWatchList(uid, "nypc");
    expect(nypc.isDefault).toBe(false);

    const promoted = await setDefaultWatchList(uid, nypc.id);
    expect(promoted?.id).toBe(nypc.id);
    expect(promoted?.isDefault).toBe(true);

    const lists = await listWatchLists(uid);
    const defaults = lists.filter((l) => l.isDefault);
    expect(defaults.length).toBe(1);
    expect(defaults[0]?.id).toBe(nypc.id);
    expect(lists.find((l) => l.id === original.id)?.isDefault).toBe(false);
    // Default-first ordering follows the reassignment.
    expect(lists[0]?.id).toBe(nypc.id);
  });

  test("setDefaultWatchList returns null for an unknown list", async () => {
    const uid = `${userId}_default_missing`;
    await ensureDefaultList(uid);
    expect(await setDefaultWatchList(uid, "wl_nope")).toBeNull();
  });

  test("default fallback in listWatchEntries follows the reassigned default", async () => {
    const uid = `${userId}_default_entries`;
    const original = await ensureDefaultList(uid);
    await upsertWatchEntry(uid, { ticker: "AAPL", source: "manual", listId: original.id });
    const nypc = await createWatchList(uid, "nypc");
    await upsertWatchEntry(uid, { ticker: "MSG", source: "manual", listId: nypc.id });

    // Before: no-listId read resolves to the original default.
    let items = await listWatchEntries(uid);
    expect(items.map((e) => e.ticker)).toEqual(["AAPL"]);

    await setDefaultWatchList(uid, nypc.id);

    // After: the same no-listId read now resolves to nypc.
    items = await listWatchEntries(uid);
    expect(items.map((e) => e.ticker)).toEqual(["MSG"]);

    // The old default is deletable now; the new default is protected.
    expect((await deleteWatchList(uid, original.id)).ok).toBe(true);
    const res = await deleteWatchList(uid, nypc.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("default");
  });
});
