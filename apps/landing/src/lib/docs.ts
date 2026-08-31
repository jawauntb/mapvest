import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Docs live in the repo root under /docs, plus a few top-level design docs.
 * Operational docs stay in the repository, but the public site only exposes
 * the product documentation selected below.
 *
 * All reads happen at build time (server components, generateStaticParams).
 * Every filesystem access is wrapped so a missing file returns null / [] —
 * the docs section must never crash the site build.
 */

// Resolve the repo root from this module so tests and builds behave the same
// regardless of their current working directory.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DOCS_DIR = path.join(REPO_ROOT, "docs");

// Extra top-level markdown files worth exposing at /docs/<slug>.
// Slug -> absolute path.
const TOP_LEVEL: Record<string, string> = {
  agents: path.join(REPO_ROOT, "AGENTS.md"),
  "implementation-plan": path.join(REPO_ROOT, "IMPLEMENTATION_PLAN.md"),
  readme: path.join(REPO_ROOT, "README.md"),
};

/**
 * Operational slugs the landing page must never surface, even though the
 * source files remain available to contributors in the repository.
 * Keep this explicit: a passing reference in a future product doc should not
 * silently remove that route from the public site.
 */
const HIDDEN_SLUGS = new Set<string>([
  "agents",
  "data-sources",
  "deploy",
  "implementation-plan",
  "market-data-migration",
  "massive-capability-matrix",
  "readme",
  "secrets",
  "system-design",
  "universe-roadmap",
]);
const HIDDEN_PREFIXES = ["loadtest-"];

export type DocMeta = {
  slug: string;
  title: string;
  source: "docs" | "root";
};

export type Doc = DocMeta & {
  content: string;
};

function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function safeRead(p: string): string | null {
  try {
    if (!safeExists(p)) return null;
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** Keep operational docs in-repo without publishing them on the marketing site. */
export function shouldPublishDoc(slug: string): boolean {
  const normalized = slug.toLowerCase();
  if (HIDDEN_SLUGS.has(normalized)) return false;
  return !HIDDEN_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Convert a filename like "SYSTEM_DESIGN.md" -> slug "system-design".
 */
export function filenameToSlug(filename: string): string {
  return filename
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

/**
 * Derive a display title. Prefer the first H1 in the file, fall back to a
 * humanized slug.
 */
function deriveTitle(content: string | null, slug: string): string {
  if (content) {
    const m = content.match(/^\s*#\s+(.+?)\s*$/m);
    if (m?.[1]) return m[1].trim();
  }
  return slug
    .split("-")
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * List every doc we know about. Never throws — missing dirs return [].
 */
export function listDocs(): DocMeta[] {
  const out: DocMeta[] = [];

  // /docs/*.md
  try {
    if (safeExists(DOCS_DIR)) {
      const files = fs.readdirSync(DOCS_DIR).filter((f) => f.toLowerCase().endsWith(".md"));
      for (const f of files) {
        const slug = filenameToSlug(f);
        const content = safeRead(path.join(DOCS_DIR, f));
        if (!shouldPublishDoc(slug)) continue;
        out.push({
          slug,
          title: deriveTitle(content, slug),
          source: "docs",
        });
      }
    }
  } catch {
    // ignore — return whatever we managed to collect
  }

  // Top-level extras (AGENTS.md, IMPLEMENTATION_PLAN.md, README.md)
  for (const [slug, filePath] of Object.entries(TOP_LEVEL)) {
    if (!safeExists(filePath)) continue;
    const content = safeRead(filePath);
    if (!shouldPublishDoc(slug)) continue;
    // Don't duplicate if /docs already had a same-slug file
    if (out.some((d) => d.slug === slug)) continue;
    out.push({
      slug,
      title: deriveTitle(content, slug),
      source: "root",
    });
  }

  // Stable order: docs first (alpha), then root extras in a curated order.
  const rootOrder = ["agents", "implementation-plan", "readme"];
  return out.sort((a, b) => {
    if (a.source !== b.source) return a.source === "docs" ? -1 : 1;
    if (a.source === "root") {
      return rootOrder.indexOf(a.slug) - rootOrder.indexOf(b.slug);
    }
    return a.slug.localeCompare(b.slug);
  });
}

/**
 * Read a single doc by slug. Returns null if not found.
 */
export function readDoc(slug: string): Doc | null {
  const normalized = slug.toLowerCase();

  // Hidden slugs — treat as if the doc doesn't exist for the landing page,
  // even if the .md file is present in the repo (agents still use it).
  if (!shouldPublishDoc(normalized)) return null;

  // Top-level match first
  const topLevelPath = TOP_LEVEL[normalized];
  if (topLevelPath) {
    const content = safeRead(topLevelPath);
    if (content == null) return null;
    return {
      slug: normalized,
      title: deriveTitle(content, normalized),
      content,
      source: "root",
    };
  }

  // Otherwise scan /docs
  try {
    if (!safeExists(DOCS_DIR)) return null;
    const files = fs.readdirSync(DOCS_DIR).filter((f) => f.toLowerCase().endsWith(".md"));
    for (const f of files) {
      if (filenameToSlug(f) === normalized) {
        const content = safeRead(path.join(DOCS_DIR, f));
        if (content == null) return null;
        return {
          slug: normalized,
          title: deriveTitle(content, normalized),
          content,
          source: "docs",
        };
      }
    }
  } catch {
    return null;
  }

  return null;
}
