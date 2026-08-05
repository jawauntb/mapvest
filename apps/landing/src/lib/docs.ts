import fs from "node:fs";
import path from "node:path";

/**
 * Docs live in the repo root under /docs, plus we surface a couple of
 * top-level design docs (AGENTS.md, IMPLEMENTATION_PLAN.md) so the landing
 * page can render everything a curious reader might want.
 *
 * All reads happen at build time (server components, generateStaticParams).
 * Every filesystem access is wrapped so a missing file returns null / [] —
 * the docs section must never crash the site build.
 */

// Resolve the repo root by walking up from this file:
//   apps/landing/src/lib/docs.ts  ->  ../../../..
const REPO_ROOT = path.resolve(process.cwd(), "..", "..");
const DOCS_DIR = path.join(REPO_ROOT, "docs");

// Extra top-level markdown files worth exposing at /docs/<slug>.
// Slug -> absolute path.
const TOP_LEVEL: Record<string, string> = {
  agents: path.join(REPO_ROOT, "AGENTS.md"),
  "implementation-plan": path.join(REPO_ROOT, "IMPLEMENTATION_PLAN.md"),
  readme: path.join(REPO_ROOT, "README.md"),
};

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
    if (m && m[1]) return m[1].trim();
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
      const files = fs
        .readdirSync(DOCS_DIR)
        .filter((f) => f.toLowerCase().endsWith(".md"));
      for (const f of files) {
        const slug = filenameToSlug(f);
        const content = safeRead(path.join(DOCS_DIR, f));
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
    // Don't duplicate if /docs already had a same-slug file
    if (out.some((d) => d.slug === slug)) continue;
    const content = safeRead(filePath);
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
    const files = fs
      .readdirSync(DOCS_DIR)
      .filter((f) => f.toLowerCase().endsWith(".md"));
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
