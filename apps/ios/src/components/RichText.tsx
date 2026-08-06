import { StyleSheet, Text, View, type TextStyle } from "react-native";
import { colors } from "@/theme/tokens";

/**
 * Lightweight article formatter for agent briefs.
 * Splits on blank lines / markdown-ish headings and bullets so research
 * output is readable instead of one dense paragraph.
 */
export function RichText({
  text,
  style,
  mutedStyle,
}: {
  text: string;
  style?: TextStyle;
  mutedStyle?: TextStyle;
}) {
  const blocks = splitBlocks(text);
  if (blocks.length === 0) {
    return <Text style={[styles.body, style]}>{text}</Text>;
  }
  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) => {
        if (b.kind === "h") {
          return (
            <Text key={i} style={[styles.heading, style]}>
              {b.text}
            </Text>
          );
        }
        if (b.kind === "li") {
          return (
            <Text key={i} style={[styles.bullet, mutedStyle ?? style]}>
              · {b.text}
            </Text>
          );
        }
        return (
          <Text key={i} style={[styles.body, i === 0 && styles.lede, style]}>
            {b.text}
          </Text>
        );
      })}
    </View>
  );
}

type Block = { kind: "p" | "h" | "li"; text: string };

function splitBlocks(raw: string): Block[] {
  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/([.!?])\s+(?=[A-Z(])/g, "$1\n\n") // soft-break run-on sentences into paras when no newlines
    .trim();
  // Prefer real paragraph breaks when the model already used them.
  const hasParas = /\n\s*\n/.test(raw) || /\n#{1,3}\s|\n[-*•]\s/.test(raw);
  const chunks = (hasParas ? raw.replace(/\r\n/g, "\n") : normalized)
    .split(/\n\s*\n+/)
    .map((c) => c.trim())
    .filter(Boolean);

  const out: Block[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1 && lines.every((l) => /^([-*•]|\d+\.)\s+/.test(l))) {
      for (const l of lines) {
        out.push({ kind: "li", text: l.replace(/^([-*•]|\d+\.)\s+/, "") });
      }
      continue;
    }
    for (const line of lines) {
      const h = line.match(/^#{1,3}\s+(.*)$/);
      if (h?.[1]) {
        out.push({ kind: "h", text: h[1] });
        continue;
      }
      const numbered = line.match(/^\d+\)\s+(.*)$/) || line.match(/^\((\d+)\)\s+(.*)$/);
      if (numbered) {
        const body = numbered[2] ?? numbered[1] ?? line;
        out.push({ kind: "h", text: body });
        continue;
      }
      // Section labels like "Business & competitive position:"
      if (/^[A-Z][^.]{2,48}:\s*$/.test(line) || /^(Lede|Business|Catalysts|Risks|Valuation|What to watch)/i.test(line)) {
        out.push({ kind: "h", text: line.replace(/:$/, "") });
        continue;
      }
      if (/^([-*•])\s+/.test(line)) {
        out.push({ kind: "li", text: line.replace(/^([-*•])\s+/, "") });
        continue;
      }
      out.push({ kind: "p", text: line });
    }
  }
  return out;
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  lede: { fontSize: 15, fontWeight: "600", color: colors.fg, lineHeight: 22 },
  body: { color: colors.fgMuted, fontSize: 14, lineHeight: 21 },
  heading: {
    color: colors.fg,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
    marginTop: 4,
  },
  bullet: { color: colors.fgDim, fontSize: 13, lineHeight: 19, paddingLeft: 2 },
});
