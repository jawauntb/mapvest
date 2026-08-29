import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type LyriaFetch,
  type MusicFileOperations,
  promoteMusicArtifacts,
  requestLyria,
} from "./music-generation.js";

const responseWithAudio = () =>
  new Response(
    JSON.stringify({
      steps: [{ content: [{ type: "audio", data: "YWJj", mime_type: "audio/wav" }] }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const responseWithAbortableBody = (signal: AbortSignal, onBodyRead = () => {}) => {
  const response = new Response(null, { status: 200 });
  response.json = () =>
    new Promise<never>((_resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      onBodyRead();
    });
  return response;
};

describe("requestLyria", () => {
  test("validates the outgoing request and incoming provider response", async () => {
    let submittedBody: unknown;
    const fetchImpl: LyriaFetch = async (_input, init) => {
      submittedBody = JSON.parse(String(init?.body));
      return responseWithAudio();
    };

    const result = await requestLyria({
      endpoint: "https://example.invalid/interactions",
      apiKey: "x",
      model: "lyria-3-pro-preview",
      prompt: "Instrumental launch soundtrack",
      fetchImpl,
    });

    expect(submittedBody).toEqual({
      model: "lyria-3-pro-preview",
      input: "Instrumental launch soundtrack",
      store: false,
    });
    expect(result.steps[0]?.content?.[0]?.mime_type).toBe("audio/wav");
  });

  test("rejects an invalid outgoing payload before fetch", async () => {
    let requestCount = 0;
    const fetchImpl: LyriaFetch = async () => {
      requestCount += 1;
      return responseWithAudio();
    };

    await expect(
      requestLyria({
        endpoint: "https://example.invalid/interactions",
        apiKey: "x",
        model: "lyria-3-pro-preview",
        prompt: "",
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(requestCount).toBe(0);
  });

  test("rejects malformed provider JSON at the schema boundary", async () => {
    const fetchImpl: LyriaFetch = async () =>
      new Response(JSON.stringify({ output: "unexpected" }), { status: 200 });

    await expect(
      requestLyria({
        endpoint: "https://example.invalid/interactions",
        apiKey: "x",
        model: "lyria-3-pro-preview",
        prompt: "Instrumental launch soundtrack",
        fetchImpl,
      }),
    ).rejects.toThrow("invalid interaction response");
  });

  test("times out the single request without retrying", async () => {
    let requestCount = 0;
    const fetchImpl: LyriaFetch = (_input, init) => {
      requestCount += 1;
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return reject(new Error("Expected a timeout signal"));
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };

    await expect(
      requestLyria({
        endpoint: "https://example.invalid/interactions",
        apiKey: "x",
        model: "lyria-3-pro-preview",
        prompt: "Instrumental launch soundtrack",
        timeoutMs: 5,
        fetchImpl,
      }),
    ).rejects.toThrow("No retry was attempted.");
    expect(requestCount).toBe(1);
  });

  test("cancels the single request from an external signal without retrying", async () => {
    const controller = new AbortController();
    let requestCount = 0;
    const fetchImpl: LyriaFetch = (_input, init) => {
      requestCount += 1;
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return reject(new Error("Expected a composed abort signal"));
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };

    const request = requestLyria({
      endpoint: "https://example.invalid/interactions",
      apiKey: "x",
      model: "lyria-3-pro-preview",
      prompt: "Instrumental launch soundtrack",
      timeoutMs: 1_000,
      signal: controller.signal,
      fetchImpl,
    });
    controller.abort(new Error("simulated SIGTERM"));

    await expect(request).rejects.toThrow("cancelled. No retry was attempted.");
    expect(requestCount).toBe(1);
  });

  test("preserves external cancellation while reading the response body", async () => {
    const controller = new AbortController();
    let reportBodyReadStarted!: () => void;
    const bodyReadStarted = new Promise<void>((resolve) => {
      reportBodyReadStarted = resolve;
    });
    const fetchImpl: LyriaFetch = async (_input, init) => {
      const requestSignal = init?.signal;
      if (!requestSignal) throw new Error("Expected a composed abort signal");
      return responseWithAbortableBody(requestSignal, reportBodyReadStarted);
    };

    const request = requestLyria({
      endpoint: "https://example.invalid/interactions",
      apiKey: "x",
      model: "lyria-3-pro-preview",
      prompt: "Instrumental launch soundtrack",
      timeoutMs: 1_000,
      signal: controller.signal,
      fetchImpl,
    });
    await bodyReadStarted;
    controller.abort(new Error("simulated SIGTERM during body read"));

    await expect(request).rejects.toThrow("cancelled. No retry was attempted.");
  });

  test("distinguishes a response-body timeout from invalid provider JSON", async () => {
    const timeoutFetch: LyriaFetch = async (_input, init) => {
      const requestSignal = init?.signal;
      if (!requestSignal) throw new Error("Expected a timeout signal");
      return responseWithAbortableBody(requestSignal);
    };
    await expect(
      requestLyria({
        endpoint: "https://example.invalid/interactions",
        apiKey: "x",
        model: "lyria-3-pro-preview",
        prompt: "Instrumental launch soundtrack",
        timeoutMs: 5,
        fetchImpl: timeoutFetch,
      }),
    ).rejects.toThrow("timed out");

    const invalidJsonFetch: LyriaFetch = async () => new Response("{", { status: 200 });
    await expect(
      requestLyria({
        endpoint: "https://example.invalid/interactions",
        apiKey: "x",
        model: "lyria-3-pro-preview",
        prompt: "Instrumental launch soundtrack",
        fetchImpl: invalidJsonFetch,
      }),
    ).rejects.toThrow("invalid JSON");
  });
});

const fileExists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

const defaultTestOperations: MusicFileOperations = {
  exists: fileExists,
  rename,
  remove: (path) => rm(path, { force: true, recursive: true }),
};

describe("promoteMusicArtifacts", () => {
  test("restores the prior accepted pair when the second promotion fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mapvest-music-rollback-"));
    const accepted = {
      audioPath: join(directory, "accepted.mp3"),
      provenancePath: join(directory, "accepted.json"),
    };
    const staged = {
      audioPath: join(directory, "staged.mp3"),
      provenancePath: join(directory, "staged.json"),
    };
    await Promise.all([
      writeFile(accepted.audioPath, "old audio"),
      writeFile(accepted.provenancePath, "old provenance"),
      writeFile(staged.audioPath, "new audio"),
      writeFile(staged.provenancePath, "new provenance"),
    ]);

    const operations: MusicFileOperations = {
      ...defaultTestOperations,
      rename: async (from, to) => {
        if (from === staged.provenancePath) throw new Error("simulated promotion failure");
        await rename(from, to);
      },
    };

    try {
      await expect(
        promoteMusicArtifacts({ staged, accepted, force: true, operations }),
      ).rejects.toThrow("prior accepted pair was restored");
      expect(await readFile(accepted.audioPath, "utf8")).toBe("old audio");
      expect(await readFile(accepted.provenancePath, "utf8")).toBe("old provenance");
      expect((await readdir(directory)).some((name) => name.includes(".backup-"))).toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("publishes both staged artifacts and removes backups after success", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mapvest-music-promotion-"));
    const accepted = {
      audioPath: join(directory, "accepted.mp3"),
      provenancePath: join(directory, "accepted.json"),
    };
    const staged = {
      audioPath: join(directory, "staged.mp3"),
      provenancePath: join(directory, "staged.json"),
    };
    await Promise.all([
      writeFile(accepted.audioPath, "old audio"),
      writeFile(accepted.provenancePath, "old provenance"),
      writeFile(staged.audioPath, "new audio"),
      writeFile(staged.provenancePath, "new provenance"),
    ]);

    try {
      await promoteMusicArtifacts({ staged, accepted, force: true });
      expect(await readFile(accepted.audioPath, "utf8")).toBe("new audio");
      expect(await readFile(accepted.provenancePath, "utf8")).toBe("new provenance");
      expect((await readdir(directory)).sort()).toEqual(["accepted.json", "accepted.mp3"]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
