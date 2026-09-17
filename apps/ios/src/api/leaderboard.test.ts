import { describe, expect, it } from "bun:test";
import { LeaderboardResponseSchema } from "./leaderboard";

describe("weekly leaderboard API", () => {
  it("parses a valid top-50 response", () => {
    const response = {
      cycleStart: "2026-09-13T12:00:00.000Z",
      cycleEnd: "2026-09-19T12:00:00.000Z",
      rows: [
        { handle: "finder-ab12cd34", earlyFindScore: 120, rank: 1, isYou: false },
        { handle: "finder-11223344", earlyFindScore: 90, rank: 2, isYou: true },
      ],
    };
    const parsed = LeaderboardResponseSchema.parse(response);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1]?.isYou).toBe(true);
  });

  it("parses the 'user not in top 50' shape — own row appended with a rank beyond the limit", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      handle: `finder-${i.toString(16).padStart(8, "0")}`,
      earlyFindScore: 500 - i,
      rank: i + 1,
      isYou: false,
    }));
    rows.push({ handle: "finder-deadbeef", earlyFindScore: 0, rank: 214, isYou: true });

    const response = {
      cycleStart: "2026-09-13T12:00:00.000Z",
      cycleEnd: "2026-09-19T12:00:00.000Z",
      rows,
    };
    const parsed = LeaderboardResponseSchema.parse(response);
    expect(parsed.rows).toHaveLength(51);
    const mine = parsed.rows.find((r) => r.isYou);
    expect(mine?.rank).toBe(214);
    expect(mine?.earlyFindScore).toBe(0);
  });

  it("rejects a row missing a required field", () => {
    const response = {
      cycleStart: "2026-09-13T12:00:00.000Z",
      cycleEnd: "2026-09-19T12:00:00.000Z",
      rows: [{ handle: "finder-ab12cd34", rank: 1, isYou: false }],
    };
    expect(() => LeaderboardResponseSchema.parse(response)).toThrow();
  });

  it("rejects a non-ISO cycle boundary", () => {
    const response = { cycleStart: "not-a-date", cycleEnd: "2026-09-19T12:00:00.000Z", rows: [] };
    expect(() => LeaderboardResponseSchema.parse(response)).toThrow();
  });
});
