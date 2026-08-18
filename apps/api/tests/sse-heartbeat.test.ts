import { describe, expect, test } from "bun:test";
import { createSseSession } from "../src/lib/sse-heartbeat.js";

describe("createSseSession", () => {
  test("serializes writes so a ping cannot split an in-flight frame", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sse = {
      writeSSE: async (message: { event?: string; data: string }) => {
        order.push(`start:${message.event}`);
        if (message.event === "article") await gate;
        order.push(`end:${message.event}`);
      },
    };
    const session = createSseSession(sse);
    try {
      const article = session.write("article", { content: "hi" });
      const ping = session.write("ping", { ts: 1 });
      release();
      await Promise.all([article, ping]);
      expect(order).toEqual(["start:article", "end:article", "start:ping", "end:ping"]);
    } finally {
      session.stop();
    }
  });
});
