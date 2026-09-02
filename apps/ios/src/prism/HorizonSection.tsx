import type { PrismPacket } from "@/api/prism";
import { HorizonFan } from "@/chartkit/prism";
import { colors, space } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { fmtSignedPct, sectionUnavailable } from "./format";
import { horizonFan } from "./scenario";
import { SectionCard } from "./ui";

/**
 * The horizon strip: what the mixture expects at each horizon and how wide the
 * band around it is. The table under the chart is the same numbers in exact
 * form, because a fan is for shape and a table is for reading.
 */
export function HorizonSection({ packet }: { packet: PrismPacket }) {
  const unavailable = sectionUnavailable(packet, "scenarios", packet.scenarios);
  const fan = horizonFan(packet.scenarios);
  const projected = fan.filter((p) => p.contributors > 0);

  return (
    <SectionCard
      eyebrow="Outlook"
      title="Horizons"
      subtitle="Probability-weighted expected return with the p10–p90 mixture band, one to eighteen months."
      unavailable={unavailable}
    >
      <HorizonFan fan={fan} />
      {projected.length > 0 ? (
        <View style={styles.table}>
          <View style={styles.headRow}>
            <Text style={[styles.cell, styles.head, styles.first]}>Horizon</Text>
            <Text style={[styles.cell, styles.head]}>p10</Text>
            <Text style={[styles.cell, styles.head]}>Expected</Text>
            <Text style={[styles.cell, styles.head]}>p90</Text>
          </View>
          {fan.map((point) => (
            <View key={point.horizon} style={styles.row}>
              <Text style={[styles.cell, styles.first, styles.label]}>
                {point.horizon.toUpperCase()}
              </Text>
              <Text style={[styles.cell, styles.dim]}>{fmtSignedPct(point.p10)}</Text>
              <Text
                style={[
                  styles.cell,
                  styles.strong,
                  point.expected === null
                    ? null
                    : { color: point.expected >= 0 ? colors.accent : colors.danger },
                ]}
              >
                {fmtSignedPct(point.expected)}
              </Text>
              <Text style={[styles.cell, styles.dim]}>{fmtSignedPct(point.p90)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.note}>No case projected a horizon in this packet.</Text>
      )}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  table: { gap: 1, marginTop: space.xs },
  headRow: { flexDirection: "row", paddingBottom: 4 },
  row: {
    flexDirection: "row",
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  cell: { flex: 1, textAlign: "right", fontSize: 12 },
  first: { flex: 1.1, textAlign: "left" },
  head: { color: colors.fgMuted, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.5 },
  label: { color: colors.fg, fontWeight: "700" },
  strong: { color: colors.fg, fontWeight: "700" },
  dim: { color: colors.fgMuted },
  note: { color: colors.fgMuted, fontSize: 12, fontStyle: "italic" },
});
