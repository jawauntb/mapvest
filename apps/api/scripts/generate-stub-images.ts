#!/usr/bin/env bun
/**
 * Generates 5 tiny 8x8 PNG stubs into apps/api/tests/fixtures/stubs/.
 * Used by tests that only care about "did we receive some bytes shaped
 * like an image" — no network, no Doppler, no vision API required.
 *
 * The stubs are deterministic (seeded by filename) so tests can rely on
 * identical bytes across runs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB_DIR = resolve(HERE, "..", "tests", "fixtures", "stubs");

const STUBS = [
  { name: "stub-red.png", rgb: [220, 40, 40] },
  { name: "stub-green.png", rgb: [40, 200, 60] },
  { name: "stub-blue.png", rgb: [40, 90, 220] },
  { name: "stub-yellow.png", rgb: [240, 210, 40] },
  { name: "stub-purple.png", rgb: [140, 60, 200] },
] as const;

const WIDTH = 8;
const HEIGHT = 8;

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i]!;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length);
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const crcVal = crc32(body);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crcVal);
  const out = new Uint8Array(len.length + body.length + crc.length);
  out.set(len, 0);
  out.set(body, len.length);
  out.set(crc, len.length + body.length);
  return out;
}

function buildPng(width: number, height: number, rgb: readonly number[]): Uint8Array {
  // PNG signature.
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR: width, height, bit depth = 8, color type = 2 (RGB), compression=0, filter=0, interlace=0.
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Raw scanlines: filter byte (0) + width*3 RGB bytes.
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const off = rowStart + 1 + x * 3;
      raw[off] = rgb[0]!;
      raw[off + 1] = rgb[1]!;
      raw[off + 2] = rgb[2]!;
    }
  }
  const idatData = deflateSync(raw);

  const ihdrChunk = chunk("IHDR", ihdr);
  const idatChunk = chunk("IDAT", new Uint8Array(idatData));
  const iendChunk = chunk("IEND", new Uint8Array(0));

  const out = new Uint8Array(sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  let p = 0;
  out.set(sig, p);
  p += sig.length;
  out.set(ihdrChunk, p);
  p += ihdrChunk.length;
  out.set(idatChunk, p);
  p += idatChunk.length;
  out.set(iendChunk, p);
  return out;
}

export function generateStubImages(dir: string = STUB_DIR): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const { name, rgb } of STUBS) {
    const bytes = buildPng(WIDTH, HEIGHT, rgb);
    const full = resolve(dir, name);
    writeFileSync(full, bytes);
    written.push(full);
  }
  return written;
}

if (import.meta.main) {
  const paths = generateStubImages();
  for (const p of paths) console.log(p);
}
