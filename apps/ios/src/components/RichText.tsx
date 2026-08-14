import { colors } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { useRouter } from "expo-router";
import { Fragment } from "react";
import { StyleSheet, Text, type TextStyle, View } from "react-native";

/**
 * Lightweight article formatter for agent briefs.
 * Splits on blank lines / markdown-ish headings and bullets so research
 * output is readable instead of one dense paragraph.
 *
 * Also auto-links inline ticker mentions ($AAPL, $JPM, $BRK.B) — they render
 * in the brand accent green and tapping opens `/detail/<TICKER>`. Matches the
 * pattern `$SYM(.SUB)?` where SYM is 1–5 uppercase letters. False positives
 * ($100, $9.99) are excluded by the leading-letter requirement.
 */
/** Models wrap titles in **bold** even when we ask for plain text. */
export function stripMdMarks(s: string): string {
  return s
    .trim()
    .replace(/^\*\*(.+)\*\*$/s, "$1")
    .replace(/^__(.+)__$/s, "$1")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .trim();
}

export function RichText({
  text,
  style,
  mutedStyle,
}: {
  text: string;
  style?: TextStyle;
  mutedStyle?: TextStyle;
}) {
  const router = useRouter();
  const openTicker = (t: string) => {
    hapticSelect();
    router.push({ pathname: "/detail/[id]", params: { id: t.toUpperCase() } });
  };

  const clean = stripMdMarks(text);
  const blocks = splitBlocks(clean);
  if (blocks.length === 0) {
    return (
      <Text style={[styles.body, style]} allowFontScaling>
        {renderInline(clean, openTicker)}
      </Text>
    );
  }
  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) => {
        if (b.kind === "h") {
          return (
            <Text key={i} style={[styles.heading, style]} allowFontScaling>
              {renderInline(b.text, openTicker)}
            </Text>
          );
        }
        if (b.kind === "li") {
          return (
            <Text key={i} style={[styles.bullet, mutedStyle ?? style]} allowFontScaling>
              · {renderInline(b.text, openTicker)}
            </Text>
          );
        }
        return (
          <Text
            key={i}
            style={[styles.body, i === 0 && styles.lede, style]}
            allowFontScaling
          >
            {renderInline(b.text, openTicker)}
          </Text>
        );
      })}
    </View>
  );
}

/**
 * Split a run of prose on inline ticker mentions and return an array of
 * React nodes. Ticker nodes render in accent color and are tappable.
 *
 * Uses a nested <Text onPress> — nesting Text is how RN gets per-span
 * interactivity without breaking wrapping. `suppressHighlighting` avoids
 * the ugly grey iOS press flash on such a small target.
 */
const TICKER_RE = /\$([A-Z]{1,5}(?:\.[A-Z]{1,3})?)(?![A-Z0-9])/g;

function renderInline(text: string, onTickerPress: (t: string) => void) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  TICKER_RE.lastIndex = 0;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop
  while ((m = TICKER_RE.exec(text)) !== null) {
    const before = text.slice(lastIndex, m.index);
    if (before) parts.push(<Fragment key={`t-${key++}`}>{before}</Fragment>);
    const sym = m[1];
    if (!sym) {
      lastIndex = m.index + m[0].length;
      continue;
    }
    parts.push(
      <Text
        key={`l-${key++}`}
        style={styles.tickerLink}
        onPress={() => onTickerPress(sym)}
        suppressHighlighting
        accessibilityRole="link"
        accessibilityLabel={`Open ${sym}`}
      >
        ${sym}
      </Text>,
    );
    lastIndex = m.index + m[0].length;
  }
  const tail = text.slice(lastIndex);
  if (tail) parts.push(<Fragment key={`t-${key++}`}>{tail}</Fragment>);
  return parts.length ? parts : text;
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
    const lines = chunk
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
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
      if (
        /^[A-Z][^.]{2,48}:\s*$/.test(line) ||
        /^(Lede|Business|Catalysts|Risks|Valuation|What to watch)/i.test(line)
      ) {
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
  // `alignSelf: "stretch"` + `width: "100%"` guarantees the wrap View honors
  // its parent's inner width so long agent prose doesn't blow past the card
  // edge on narrow devices (iPhone SE, split-screen). Direct Text children
  // then get `flexShrink: 1` so any single line with a very long
  // unbreakable token also stays inside the box.
  wrap: { gap: 10, alignSelf: "stretch", width: "100%" },
  lede: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.fg,
    lineHeight: 22,
    flexShrink: 1,
  },
  body: { color: colors.fgMuted, fontSize: 14, lineHeight: 21, flexShrink: 1 },
  heading: {
    color: colors.fg,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
    marginTop: 4,
    flexShrink: 1,
  },
  bullet: {
    color: colors.fgDim,
    fontSize: 13,
    lineHeight: 19,
    paddingLeft: 2,
    flexShrink: 1,
  },
  tickerLink: {
    color: colors.accent,
    fontWeight: "700",
  },
});
