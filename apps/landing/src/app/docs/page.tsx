import type { Metadata } from "next";
import Link from "next/link";
import { listDocs } from "../../lib/docs";

export const metadata: Metadata = {
  title: "Docs",
  description: "How Mapvest is built — architecture, data sources, and the rules of the world.",
};

// Every markdown file under /docs is read from the filesystem at build time.
export const dynamic = "force-static";

export default function DocsIndexPage() {
  const docs = listDocs();

  return (
    <section className="section container">
      <div className="section__eyebrow">Docs</div>
      <h1 className="section__title">How Mapvest is built.</h1>
      <p className="section__lead">
        The architecture, the data sources, the rules of the world — rendered straight from the
        markdown files in the repo. If a piece of Mapvest isn't in here, it isn't shipping yet.
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
