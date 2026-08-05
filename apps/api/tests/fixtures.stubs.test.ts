/**
 * Non-integration tests for the fixture manifest and the in-memory stub
 * PNGs. Runs under normal `bun test` — no network, no Doppler.
 *
 * The stubs themselves live in apps/api/tests/fixtures/stubs/ and are
 * generated on demand by ../scripts/generate-stub-images.ts.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateStubImages } from "../scripts/generate-stub-images.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const STUBS_DIR = resolve(HERE, "fixtures", "stubs");
const URLS_PATH = resolve(HERE, "fixtures", "urls.json");

type Manifest = {
  fixtures: Array<{
    id: string;
    filename: string;
    url: string;
    license: string;
    expected: { brand: string; ticker: string; sector?: string };
  }>;
};

describe("fixture stubs", () => {
  test("generates 5 valid 8x8 PNG stubs", () => {
    const paths = generateStubImages(STUBS_DIR);
    expect(paths.length).toBe(5);
    for (const p of paths) {
      const bytes = readFileSync(p);
      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      expect(bytes[0]).toBe(0x89);
      expect(bytes[1]).toBe(0x50);
      expect(bytes[2]).toBe(0x4e);
      expect(bytes[3]).toBe(0x47);
      expect(bytes[4]).toBe(0x0d);
      expect(bytes[5]).toBe(0x0a);
      expect(bytes[6]).toBe(0x1a);
      expect(bytes[7]).toBe(0x0a);
      // 8x8 stays well under 200 bytes.
      expect(bytes.length).toBeLessThan(200);
    }
  });

  test("stubs are deterministic between generations", () => {
    const first = generateStubImages(STUBS_DIR).map((p) => readFileSync(p));
    const second = generateStubImages(STUBS_DIR).map((p) => readFileSync(p));
    expect(first.length).toBe(second.length);
    for (let i = 0; i < first.length; i++) {
      expect(Buffer.compare(first[i]!, second[i]!)).toBe(0);
    }
  });
});

describe("urls.json manifest", () => {
  const manifest = JSON.parse(readFileSync(URLS_PATH, "utf8")) as Manifest;

  test("covers the six seed brands", () => {
    const ids = new Set(manifest.fixtures.map((f) => f.id));
    for (const id of [
      "mcdonalds-storefront",
      "hersheys-bar",
      "starbucks-cup",
      "walmart-aisle-sign",
      "nike-shoe",
      "chevron-pump",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  test("every entry declares an https URL, a brand, and a ticker", () => {
    for (const f of manifest.fixtures) {
      expect(f.url.startsWith("https://")).toBe(true);
      expect(f.filename.length).toBeGreaterThan(0);
      expect(f.license.length).toBeGreaterThan(0);
      expect(f.expected.brand.length).toBeGreaterThan(0);
      expect(/^[A-Z.-]{1,6}$/.test(f.expected.ticker)).toBe(true);
    }
  });
});
