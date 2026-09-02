import { describe, expect, test } from "bun:test";
import { listDocs, readDoc, shouldPublishDoc } from "../src/lib/docs";

const PROVIDER_BRAND = /\bmassive\b|\bpolygon(?:\.io)?\b/i;

describe("public docs policy", () => {
  test("publishes provider-neutral product documentation", () => {
    expect(shouldPublishDoc("architecture")).toBe(true);
    expect(shouldPublishDoc("demo-video")).toBe(true);
    expect(shouldPublishDoc("share-and-widgets")).toBe(true);
  });

  test("keeps the explicit operational inventory off the public site", () => {
    for (const slug of [
      "agents",
      "data-sources",
      "deploy",
      "implementation-plan",
      "market-data-migration",
      "massive-capability-matrix",
      "prism",
      "readme",
      "secrets",
      "system-design",
      "universe-roadmap",
      "loadtest-v0.1.0",
    ]) {
      expect(shouldPublishDoc(slug)).toBe(false);
      expect(readDoc(slug)).toBeNull();
    }
  });

  test("publishes only provider-neutral documentation", () => {
    const docs = listDocs();

    expect(docs.map(({ slug }) => slug)).toEqual([
      "architecture",
      "demo-video",
      "share-and-widgets",
    ]);

    for (const { slug } of docs) {
      const doc = readDoc(slug);
      expect(doc).not.toBeNull();
      expect(doc?.content).not.toMatch(PROVIDER_BRAND);
    }
  });
});
