import type { Metadata } from "next";
import Link from "next/link";
import { listDocs } from "../../lib/docs";

export const metadata: Metadata = {
  title: "Docs",
  description: "Public product architecture and guides for Mapvest.",
};

// Every markdown file under /docs is read from the filesystem at build time.
export const dynamic = "force-static";

export default function DocsIndexPage() {
  const docs = listDocs();

  return (
    <section className="section container">
      <div className="section__eyebrow">Docs</div>
      <h1 className="section__title">How Mapvest works.</h1>
      <p className="section__lead">
        Public product architecture and guides, rendered from the markdown files that live in the
        repository. Operational provider details remain in the source tree for maintainers.
      </p>

      {docs.length === 0 ? (
        <p style={{ color: "var(--fg-dim)" }}>
          No documentation files found. Add markdown files to <code>docs/</code> in the repo root.
        </p>
      ) : (
        <ul className="doc-list">
          {docs.map((doc) => (
            <li key={doc.slug}>
              <Link href={`/docs/${doc.slug}`} className="doc-card">
                <div className="doc-card__slug">/docs/{doc.slug}</div>
                <div className="doc-card__title">{doc.title}</div>
                <div className="doc-card__meta">
                  {doc.source === "docs" ? "docs/" : "repo root"}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
