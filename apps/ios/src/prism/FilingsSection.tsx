import type { PrismFiling, PrismPacket } from "@/api/prism";
import { colors, fonts, radii, space, type } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { fmtDate, humanize, sectionUnavailable } from "./format";
import { SectionCard } from "./ui";

/** The six cross-filing questions the engine synthesises, in reading order. */
const SYNTHESIS_ORDER: ReadonlyArray<{ key: string; title: string }> = [
  { key: "performance", title: "Performance" },
  { key: "risks", title: "Risks" },
  { key: "growth_opportunities", title: "Growth opportunities" },
  { key: "new_business_lines", title: "New business lines" },
  { key: "operating_context", title: "Operating context" },
  { key: "capex_suppliers_customers", title: "Capex, suppliers, customers" },
];

/**
 * What the company itself said, read across its last two 10-Ks and three 10-Qs.
 *
 * Every card here is a synthesis of primary text — Business, Risk Factors, and
 * MD&A — and every filing keeps its EDGAR link, so a claim can be checked
 * against the document rather than taken on the model's word.
 */
export function FilingsSection({ packet }: { packet: PrismPacket }) {
  const filings = packet.filings;
  const unavailable = sectionUnavailable(packet, "filings", filings);
  const synthesis = filings?.synthesis ?? {};
  const documents: PrismFiling[] = [...(filings?.ten_k ?? []), ...(filings?.ten_q ?? [])];
  // A section can be present and still hold nothing — an ETF has no 10-K, and a
  // filing fetch can succeed with zero documents. Say that instead of rendering
  // a heading over an empty card.
  const synthesised = SYNTHESIS_ORDER.some(
    ({ key }) => typeof synthesis[key] === "string" && (synthesis[key] as string).trim().length > 0,
  );
  const empty = !unavailable && !synthesised && documents.length === 0;

  return (
    <SectionCard
      eyebrow="Filings"
      title="What the company said"
      subtitle={`${documents.length} SEC filing${documents.length === 1 ? "" : "s"} read end to end.`}
      unavailable={unavailable}
    >
      {empty ? (
        <Text style={styles.note}>
          No 10-K or 10-Q was available for this symbol — index and fund tickers do not file them,
          and a company that has not reported yet has nothing to read.
        </Text>
      ) : null}

      {SYNTHESIS_ORDER.map(({ key, title }) => {
        const body = synthesis[key];
        if (typeof body !== "string" || body.trim().length === 0) return null;
        return (
          <View key={key} style={styles.card}>
            <Text style={styles.cardTitle}>{title}</Text>
            <Text style={styles.cardBody}>{body.trim()}</Text>
          </View>
        );
      })}

      {documents.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.blockTitle}>Documents</Text>
          {documents.map((doc, i) => {
            const url = typeof doc.url === "string" && doc.url.startsWith("http") ? doc.url : null;
            const label = `${humanize(doc.form, "Filing")} · ${fmtDate(doc.filing_date)}`;
            const body = (
              <View style={styles.docRow}>
                <Ionicons
                  name="document-text-outline"
                  size={15}
                  color={url ? colors.accent : colors.fgDim}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.docTitle}>{label}</Text>
                  {doc.summary ? (
                    <Text style={styles.docSummary} numberOfLines={4}>
                      {doc.summary}
                    </Text>
                  ) : null}
                </View>
                {url ? <Ionicons name="open-outline" size={14} color={colors.fgDim} /> : null}
              </View>
            );
            if (!url) {
              // biome-ignore lint/suspicious/noArrayIndexKey: two filings can share a form and date, so position is the only stable id
              return <View key={`${label}-${i}`}>{body}</View>;
            }
            return (
              <Pressable
                // biome-ignore lint/suspicious/noArrayIndexKey: two filings can share a form and date, so position is the only stable id
                key={`${label}-${i}`}
                onPress={() => {
                  void Linking.openURL(url).catch(() => {});
                }}
                accessibilityRole="link"
                accessibilityLabel={`Open ${label} on EDGAR`}
                style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
              >
                {body}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  note: { color: colors.fgMuted, fontSize: 12, fontStyle: "italic", lineHeight: 17 },
  card: {
    backgroundColor: colors.bgSunken,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: 6,
  },
  cardTitle: { color: colors.accent, ...type.caption, letterSpacing: 0.9 },
  cardBody: { color: colors.fg, fontFamily: fonts.serif, fontSize: 14, lineHeight: 21 },
  blockTitle: { color: colors.fgMuted, ...type.label, marginTop: space.xs },
  docRow: { flexDirection: "row", alignItems: "flex-start", gap: space.sm, paddingVertical: 4 },
  docTitle: { color: colors.fg, fontSize: 12.5, fontWeight: "700" },
  docSummary: { color: colors.fgMuted, fontSize: 12, lineHeight: 17 },
});
