/** Split agent brief text into readable blocks (paragraphs / headings / bullets). */
export function FormattedBrief({ text }: { text: string }) {
  const blocks = splitBrief(text);
  return (
    <div className="app-overview-body">
      {blocks.map((b, i) => {
        if (b.kind === "h") return <h3 key={i}>{b.text}</h3>;
        if (b.kind === "li") return <p key={i}>· {b.text}</p>;
        return <p key={i}>{b.text}</p>;
      })}
    </div>
  );
}

type Block = { kind: "p" | "h" | "li"; text: string };

function splitBrief(raw: string): Block[] {
  const hasStructure = /\n\s*\n/.test(raw) || /\n#{1,3}\s|\n[-*•]\s/.test(raw);
  const source = hasStructure
    ? raw
    : raw.replace(/([.!?])\s+(?=[A-Z(])/g, "$1\n\n");
  const chunks = source
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((c) => c.trim())
    .filter(Boolean);
  const out: Block[] = [];
  for (const chunk of chunks) {
    for (const line of chunk.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const h = line.match(/^#{1,3}\s+(.*)$/);
      if (h?.[1]) {
        out.push({ kind: "h", text: h[1] });
        continue;
      }
      if (/^([-*•]|\d+\.)\s+/.test(line)) {
        out.push({ kind: "li", text: line.replace(/^([-*•]|\d+\.)\s+/, "") });
        continue;
      }
      out.push({ kind: "p", text: line });
    }
  }
  return out.length ? out : [{ kind: "p", text: raw }];
}
