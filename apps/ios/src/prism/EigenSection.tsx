import type { PrismPacket } from "@/api/prism";
import { colors, space, type } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { fmtNumber, fmtPct, humanize, sectionUnavailable } from "./format";
import { Chip, KeyValueRow, SectionCard } from "./ui";

/**
 * Which inputs actually carry the call.
 *
 * Two different claims live here and are kept apart on purpose. The ranking is
 * correlational — how each signal has co-moved with forward returns over three
 * lookbacks. "Load-bearing" is causal *within the model*: the engine removes
 * one signal, re-runs the scenario weighting, and reports how much the weights
 * moved. A signal can rank highly and still not be load-bearing, which is
 * exactly the distinction worth showing.
 */
export function EigenSection({ packet }: { packet: PrismPacket }) {
  const eigen = packet.eigen;
  const unavailable = sectionUnavailable(packet, "eigen", eigen);
  const ranking = (eigen?.signal_ranking ?? []).slice(0, 8);
  const loadBearing = eigen?.load_bearing ?? [];
  const variance = (eigen?.pca?.explained_variance_ratio ?? []).slice(0, 4);
  const broken = eigen?.symmetry?.broken_pairs ?? [];
  const invariant = eigen?.symmetry?.gauge_invariant_pairs ?? [];

  return (
    <SectionCard
      eyebrow="Signals"
      title="What is carrying this call"
      subtitle="Correlation ranking, principal components, and the leave-one-out load-bearing test."
      unavailable={unavailable}
    >
      {ranking.length > 0 ? (
        <View style={{ gap: 2 }}>
          <View style={styles.headRow}>
            <Text style={[styles.cell, styles.head, styles.first]}>Signal</Text>
            <Text style={[styles.cell, styles.head]}>1Y</Text>
            <Text style={[styles.cell, styles.head]}>6M</Text>
            <Text style={[styles.cell, styles.head]}>3M</Text>
          </View>
          {ranking.map((row) => (
            <View key={row.signal} style={styles.row}>
              <Text style={[styles.cell, styles.first]} numberOfLines={1}>
                {humanize(row.signal)}
              </Text>
              <Text style={styles.cell}>{fmtNumber(row.corr_1y, 2)}</Text>
              <Text style={[styles.cell, styles.dim]}>{fmtNumber(row.corr_6m, 2)}</Text>
              <Text style={[styles.cell, styles.dim]}>{fmtNumber(row.corr_3m, 2)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {loadBearing.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.blockTitle}>Load-bearing</Text>
          <View style={styles.chipRow}>
            {loadBearing.map((row) => (
              <Chip
                key={row.signal}
                label={`${humanize(row.signal)} ${fmtPct(row.weight_delta_if_removed, 0)}`}
                tone={row.load_bearing ? "bull" : "neutral"}
              />
            ))}
          </View>
          <Text style={styles.note}>
            Percentages are how far the scenario weights move when that signal is removed. Jade
            chips changed the answer; grey ones did not.
          </Text>
        </View>
      ) : null}

      {variance.length > 0 ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.blockTitle}>Principal components</Text>
          {variance.map((value, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: component order IS the identity — PC1 is the first eigenvector
            <KeyValueRow key={`pc-${i}`} label={`PC${i + 1}`} value={fmtPct(value, 1)} />
          ))}
        </View>
      ) : null}

      {broken.length > 0 || invariant.length > 0 ? (
        <Text style={styles.note}>
          Across regimes, {invariant.length} benchmark pair{invariant.length === 1 ? "" : "s"} kept
          their sign (gauge invariant) and {broken.length} flipped — a flip is a relationship the
          current regime has broken.
        </Text>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  blockTitle: { color: colors.fgMuted, ...type.label, marginTop: space.xs },
  headRow: { flexDirection: "row", paddingBottom: 4 },
  row: {
    flexDirection: "row",
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  cell: { flex: 1, textAlign: "right", fontSize: 12, color: colors.fg, fontWeight: "600" },
  first: { flex: 2.2, textAlign: "left" },
  head: { color: colors.fgMuted, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.5 },
  dim: { color: colors.fgMuted, fontWeight: "400" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  note: { color: colors.fgMuted, fontSize: 11.5, lineHeight: 17 },
});
