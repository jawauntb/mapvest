import type { PrismPacket } from "@/api/prism";
import { RichText } from "@/components/RichText";
import { colors, fonts, radii, space, type } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { fmtPct, humanize, relativeAge, sectionUnavailable, toneForLabel } from "./format";
import { CitationRow, SectionCard, toneFg } from "./ui";

/**
 * The memo itself, set in the serif editorial face the rest of Mapvest uses for
 * long-form research.
 *
 * Three things sit under the prose and are not decoration: the key
 * determinants (what the call rests on, with direction and weight), what the
 * model believes is already priced in, and the citations — each pointing back
 * at a packet section or a fetched document, so every claim has a source.
 */
export function MemoSection({ packet }: { packet: PrismPacket }) {
  const memo = packet.memo;
  const unavailable = sectionUnavailable(packet, "memo", memo);
  const determinants = memo?.key_determinants ?? [];
  const pricedIn = memo?.priced_in ?? [];
  const citations = memo?.citations ?? [];

  return (
    <SectionCard
      eyebrow="Memo"
      title="The write-up"
      subtitle={
        memo?.model
          ? `${memo.model}${memo.generated_at ? ` · ${relativeAge(memo.generated_at)}` : ""}`
          : undefined
      }
      unavailable={unavailable}
    >
      {memo?.text ? (
        <RichText
          text={memo.text}
          style={styles.prose}
          mutedStyle={{ ...styles.prose, color: colors.fgMuted }}
        />
      ) : (
        <Text style={styles.note}>
          This packet was built without a memo. Rebuild with the memo enabled to get the write-up.
        </Text>
      )}

      {determinants.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Text style={styles.blockTitle}>Key determinants</Text>
          {determinants.map((row) => (
            <View key={row.name} style={styles.determinant}>
              <View style={styles.determinantHead}>
                <Text
                  style={[styles.determinantName, { color: toneFg(toneForLabel(row.direction)) }]}
                >
                  {humanize(row.name)}
                </Text>
                <Text style={styles.determinantWeight}>
                  {row.weight === null || row.weight === undefined ? "" : fmtPct(row.weight, 0)}
                </Text>
              </View>
              <Text style={styles.determinantBody}>{row.explanation}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {pricedIn.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={styles.blockTitle}>Already priced in</Text>
          {pricedIn.map((line) => (
            <Text key={line} style={styles.bullet}>
              · {line}
            </Text>
          ))}
        </View>
      ) : null}

      {citations.length > 0 ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.blockTitle}>Citations</Text>
          {citations.map((citation) => (
            <CitationRow
              key={citation.id}
              id={citation.id}
              claim={citation.claim}
              source={citation.source}
              url={citation.url}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.disclaimerRow}>
        <Ionicons name="information-circle-outline" size={13} color={colors.fgDim} />
        <Text style={styles.disclaimer}>Research only. Not investment advice.</Text>
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  prose: { fontFamily: fonts.serif, fontSize: 15, lineHeight: 23, color: colors.fg },
  note: { color: colors.fgMuted, fontSize: 12.5, fontStyle: "italic", lineHeight: 18 },
  blockTitle: { color: colors.fgMuted, ...type.label, marginTop: space.xs },
  determinant: {
    backgroundColor: colors.bgSunken,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: 4,
  },
  determinantHead: { flexDirection: "row", justifyContent: "space-between", gap: space.sm },
  determinantName: { fontSize: 12.5, fontWeight: "800", flexShrink: 1 },
  determinantWeight: { color: colors.fgMuted, fontSize: 11.5, fontWeight: "700" },
  determinantBody: { color: colors.fgMuted, fontSize: 12.5, lineHeight: 18 },
  bullet: { color: colors.fgMuted, fontSize: 12.5, lineHeight: 18 },
  disclaimerRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: space.xs },
  disclaimer: { color: colors.fgMuted, fontSize: 11 },
});
