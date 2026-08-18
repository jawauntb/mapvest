/**
 * Keep an SSE response alive while we wait on Derivation or OpenRouter.
 *
 * Railway Hikari (and iOS URLSession) close idle streamed responses after
 * ~10s with no bytes. /v1/agent/stream used to send one "Contacting
 * research agent…" frame, then go silent for the upstream round-trip —
 * the client saw EOF and showed "stream ended without an article", while
 * the blocking /v1/agent/chat path still returned a brief.
 *
 * Writes are queued so a ping cannot interleave bytes with an in-flight
 * article/token frame.
 */

export function sseHeartbeatMs(): number {
  const n = Number(process.env.SSE_HEARTBEAT_MS ?? 3_000);
  return Number.isFinite(n) && n > 0 ? n : 3_000;
}

export type SseWriter = {
  writeSSE: (message: { event?: string; data: string }) => Promise<void>;
};

export function createSseSession(sse: SseWriter): {
  write: (event: string, data: unknown) => Promise<void>;
  stop: () => void;
} {
  let queue: Promise<void> = Promise.resolve();

  const write = (event: string, data: unknown): Promise<void> => {
    const task = () => sse.writeSSE({ event, data: JSON.stringify(data) });
    const next = queue.then(task, task);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const timer = setInterval(() => {
    void write("ping", { ts: Date.now() });
  }, sseHeartbeatMs());
  if (typeof timer.unref === "function") timer.unref();

  return {
    write,
    stop() {
      clearInterval(timer);
    },
  };
}
