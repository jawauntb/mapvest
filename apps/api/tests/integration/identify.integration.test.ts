/**
 * Integration test for the vision-identify pipeline.
 *
 * Gated behind INTEGRATION=1 so it does NOT run under normal `bun test`.
 * Run it via `apps/api/scripts/run-integration.sh` (which wraps it in
 * `doppler run --project mapvest --config dev`).
 *
 * When MOCK_FIXTURES=1, the image downloads are stubbed with tiny PNGs
 * generated in-memory (see ../../scripts/generate-stub-images.ts). The
 * real identifyFromImage() call still fires — the mock only replaces
 * the network fetch for the fixture URLs, not the OpenRouter call.
 *
 * Under INTEGRATION=1 without MOCK_FIXTURES=1 we download the real
 * images from urls.json and hit the real OpenRouter API. Doppler must
 * supply OPENROUTER_API_KEY.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(HERE, "..", "fixtures");
const STUBS_DIR = resolve(FIXTURES_DIR, "stubs");
const URLS_PATH = resolve(FIXTURES_DIR, "urls.json");

type Fixture = {
  id: string;
  filename: string;
  url: string;
  license: string;
  expected: { brand: string; ticker: string; sector?: string };
  notes?: string;
};

type Manifest = {
  fixtures: Fixture[];
};

const INTEGRATION = process.env.INTEGRATION === "1";
const MOCK_FIXTURES = process.env.MOCK_FIXTURES === "1";

// bun:test uses describe.skip to no-op a whole block; toggle by env so
// that a plain `bun test` in the repo never reaches this suite.
const suite = INTEGRATION ? describe : describe.skip;

suite("identify pipeline — real API", () => {
  const manifest = JSON.parse(readFileSync(URLS_PATH, "utf8")) as Manifest;

  // Lazy import so the top-level module load doesn't require the
  // @mapvest/vision package to resolve when we're not running.
  let identifyFromImage: (typeof import("@mapvest/vision"))["identifyFromImage"];
  let generateStubImages: (typeof import("../../scripts/generate-stub-images.js"))["generateStubImages"];

  beforeAll(async () => {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error(
        "OPENROUTER_API_KEY missing — run via apps/api/scripts/run-integration.sh so Doppler injects it.",
      );
    }
    ({ identifyFromImage } = await import("@mapvest/vision"));
    ({ generateStubImages } = await import("../../scripts/generate-stub-images.js"));
  });

  async function loadImage(fixture: Fixture): Promise<Uint8Array> {
    const local = resolve(FIXTURES_DIR, fixture.filename);
    if (existsSync(local)) {
      return new Uint8Array(readFileSync(local));
    }
    if (MOCK_FIXTURES) {
      // Deterministic in-memory PNG per fixture id so we don't hit the
      // network at all in CI. The real vision API is still called, which
      // is what the assertion actually cares about.
      const stubPaths = generateStubImages(STUBS_DIR);
      let h = 0;
      for (const ch of fixture.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
      const pick = stubPaths[Math.abs(h) % stubPaths.length]!;
      return new Uint8Array(readFileSync(pick));
    }
    // Real network fetch, only when explicitly running the full integration.
    const res = await fetch(fixture.url);
    if (!res.ok) throw new Error(`fetch ${fixture.url} => ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  for (const fixture of manifest.fixtures) {
    test(
      `${fixture.id} → ${fixture.expected.brand} (${fixture.expected.ticker})`,
      async () => {
        const bytes = await loadImage(fixture);
        expect(bytes.length).toBeGreaterThan(0);

        const identification = await identifyFromImage(bytes);
        expect(identification).toBeDefined();
        expect(Array.isArray(identification.detected)).toBe(true);
        expect(typeof identification.modelUsed).toBe("string");

        if (MOCK_FIXTURES) {
          // With stub images the model has nothing meaningful to see;
          // we only assert the pipeline round-trip works.
          return;
        }

        const brands = identification.detected
          .map((d) => (d.brand ?? "").toLowerCase())
          .filter(Boolean);
        expect(brands.some((b) => b.includes(fixture.expected.brand.toLowerCase()))).toBe(true);
      },
      60_000,
    );
  }
});
