import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdownImport from "react-markdown";
import remarkGfm from "remark-gfm";
import { listDocs, readDoc } from "../../../lib/docs";

// react-markdown's return type is `ReactElement`, which does not satisfy
// React 19's `ReactNode` constraint (missing `children` on `ReactPortal`).
// Cast to a plain function component so the JSX call type-checks; runtime
// behavior is unchanged.
const ReactMarkdown = ReactMarkdownImport as unknown as (props: {
  // biome-ignore lint/suspicious/noExplicitAny: pass-through
  remarkPlugins?: any[];
  children: string;
  // biome-ignore lint/suspicious/noExplicitAny: return type erased for compat
}) => any;

export const dynamic = "force-static";

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return listDocs().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = readDoc(slug);
  if (!doc) {
    return { title: "Not found" };
  }
  return {
    title: doc.title,
    description: `${doc.title} — Mapvest documentation.`,
  };
}

export default async function DocPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const doc = readDoc(slug);
  if (!doc) notFound();

  return (
    <div className="container">
      <article className="article">
        <Link href="/docs" className="article__back">
          ← All docs
        </Link>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
      </article>
    </div>
  );
}
