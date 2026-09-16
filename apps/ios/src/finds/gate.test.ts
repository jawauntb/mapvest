import { describe, expect, test } from "bun:test";
import { hasFirstFind, readGuestFlag } from "./gate";

describe("hasFirstFind", () => {
  test("no finds + no flag → false", () => {
    expect(hasFirstFind({ finds: [], guestFlag: null })).toBe(false);
    expect(hasFirstFind({ finds: undefined, guestFlag: undefined })).toBe(false);
  });

  test("≥1 find + any flag → true", () => {
    const finds = [{ id: "find-1" }];
    expect(hasFirstFind({ finds, guestFlag: null })).toBe(true);
    expect(hasFirstFind({ finds, guestFlag: "1" })).toBe(true);
    expect(hasFirstFind({ finds, guestFlag: "0" })).toBe(true);
  });

  test('no finds + flag "1" → true', () => {
    expect(hasFirstFind({ finds: [], guestFlag: "1" })).toBe(true);
  });

  test("storage read throws → false", () => {
    const guestFlag = readGuestFlag(() => {
      throw new Error("AsyncStorage unavailable");
    });
    expect(guestFlag).toBeNull();
    expect(hasFirstFind({ finds: [], guestFlag })).toBe(false);
  });
});
