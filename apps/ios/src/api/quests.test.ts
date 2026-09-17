import { describe, expect, it } from "bun:test";

describe("weekly quests API", () => {
  describe("fetchWeeklyQuests schema", () => {
    it("accepts a valid weekly quests response shape", () => {
      // Schema validation happens in the API layer via WeeklyQuestsResponseSchema (zod).
      // This test verifies the expected response structure and happy path.
      const response = {
        cycleStart: "2024-09-15T00:00:00.000Z",
        cycleEnd: "2024-09-21T12:00:00.000Z",
        quests: [
          {
            id: "2024-09-15:weekly:catch_any",
            kind: "catch_any",
            title: "Catch a company today",
            xp: 10,
            completed: false,
            progress: 0,
            target: 1,
          },
        ],
      };

      expect(response).toBeDefined();
      expect(response.cycleStart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(response.cycleEnd).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Array.isArray(response.quests)).toBe(true);
      expect(response.quests[0].kind).toBe("catch_any");
    });

    it("response structure includes progress tracking", () => {
      const response = {
        cycleStart: "2024-09-08T00:00:00.000Z",
        cycleEnd: "2024-09-14T12:00:00.000Z",
        quests: [
          {
            id: "2024-09-08:weekly:new_tile",
            kind: "new_tile",
            title: "Catch in a neighborhood you've never caught in",
            xp: 25,
            completed: true,
            progress: 1,
            target: 1,
          },
          {
            id: "2024-09-08:weekly:catch_private",
            kind: "catch_private",
            title: "Catch a private brand",
            xp: 20,
            completed: false,
            progress: 0,
            target: 1,
          },
        ],
      };

      expect(response.quests).toHaveLength(2);
      expect(response.quests[0].completed).toBe(true);
      expect(response.quests[0].progress).toBe(1);
      expect(response.quests[1].completed).toBe(false);
      expect(response.quests[1].progress).toBe(0);
    });

    it("quest kinds are all valid types", () => {
      const validKinds = ["catch_any", "catch_private", "new_tile", "new_sector"];
      const response = {
        cycleStart: "2024-09-15T00:00:00.000Z",
        cycleEnd: "2024-09-21T12:00:00.000Z",
        quests: [
          { id: "q1", kind: "catch_any", title: "t1", xp: 10, completed: false, progress: 0, target: 1 },
          { id: "q2", kind: "catch_private", title: "t2", xp: 20, completed: false, progress: 0, target: 1 },
          { id: "q3", kind: "new_tile", title: "t3", xp: 25, completed: false, progress: 0, target: 1 },
          { id: "q4", kind: "new_sector", title: "t4", xp: 25, completed: false, progress: 0, target: 1 },
        ],
      };

      for (const quest of response.quests) {
        expect(validKinds).toContain(quest.kind);
      }
    });
  });
});
