import type { SituatePacket } from "@/api/situate";
import { RichText } from "@/components/RichText";
import { colors, fonts, radii, space, type } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import {
  convictionLabel,
  fmtPct,
  humanize,
  postureHorizon,
  relativeAge,
  stanceLabel,
  stanceTone,
  toneForLabel,
} from "./format";
import { sectionUnavailable } from "./signals";
import { Chip, CitationRow, Meter, SectionCard, toneFg } from "./ui";

/**
 * The memo, set in the serif editorial face. The call is a POSTURE — a chip and
 * a conviction meter, never a buy/sell verb — followed by the prose, the three
 * falsifiers (what would prove it wrong), the key determinants, what's already
 * priced in, and citations that resolve to a module + version.
 */
export function MemoSection({ packet }: { packet: SituatePacket }) {
  const memo = packet.memo;
  const unavailable = sectionUnavailable(packet, "memo", memo);
  const posture = memo?.posture ?? null;
  const tone = stanceTone(posture?.stance);
  const conviction = typeof posture?.conviction === "number" ? posture.conviction : null;
  const falsifiers = memo?.falsifiers ?? [];
  const determinants = memo?.key_determinants ?? [];
  const pricedIn = memo?.whats_priced_in ?? [];
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
      {posture ? (
        <View style={styles.postureBox}>
          <View style={styles.postureHead}>
            <Chip
              label={`${stanceLabel(posture.stance)}${
                postureHorizon(posture.horizon) ? ` · ${postureHorizon(posture.horizon)}` : ""
              }`}
              tone={tone}
              solid
            />
            {conviction !== null ? (
              <Text style={[styles.convValue, { color: toneFg(tone) }]}>
                {fmtPct(conviction, 0)}
              </Text>
            ) : null}
          </View>
          {conviction !== null ? (
            <>
              <Meter value={conviction} tone={tone} height={6} />
              <Text style={styles.convLabel}>{convictionLabel(conviction)}</Text>
            </>
          ) : null}
        </View>
      ) : null}

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

      {falsifiers.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={styles.blockTitle}>What would prove this wrong</Text>
          {falsifiers.map((f) => (
            <View key={f} style={styles.falsifierRow}>
              <Ionicons name="close-circle-outline" size={13} color={colors.danger} />
              <Text style={styles.falsifier}>{f}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {determinants.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Text style={styles.blockTitle}>Key determinants</Text>
          {determinants.map((row) => (
            <View key={row.name} style={styles.determinant}>
              <Text
                style={[styles.determinantName, { color: toneFg(toneForLabel(row.direction)) }]}
              >
                {humanize(row.name)}
              </Text>
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
              source={
                citation.module
                  ? `${citation.module}${citation.version ? ` · v${citation.version}` : ""}`
                  : null
              }
              url={citation.url}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.disclaimerRow}>
        <Ionicons name="information-circle-outline" size={13} color={colors.fgDim} />
        <Text style={styles.disclaimer}>
          The data suggests — not investment advice, and never a buy/sell call.
        </Text>
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  postureBox: {
    backgroundColor: colors.bgSunken,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: 6,
  },
  postureHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  convValue: { fontSize: 14, fontWeight: "800" },
  convLabel: { color: colors.fgMuted, fontSize: 11 },
  prose: { fontFamily: fonts.serif, fontSize: 15, lineHeight: 23, color: colors.fg },
  note: { color: colors.fgMuted, fontSize: 12.5, fontStyle: "italic", lineHeight: 18 },
  blockTitle: { color: colors.fgMuted, ...type.label, marginTop: space.xs },
  falsifierRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  falsifier: { color: colors.fg, fontSize: 12.5, lineHeight: 18, flex: 1 },
  determinant: {
    backgroundColor: colors.bgSunken,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: 4,
  },
  determinantName: { fontSize: 12.5, fontWeight: "800" },
  determinantBody: { color: colors.fgMuted, fontSize: 12.5, lineHeight: 18 },
  bullet: { color: colors.fgMuted, fontSize: 12.5, lineHeight: 18 },
  disclaimerRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: space.xs },
  disclaimer: { color: colors.fgMuted, fontSize: 11, flex: 1 },
});
