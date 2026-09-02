import { PRISM_HORIZONS, type PrismPacket } from "@/api/prism";
import { SeasonalityGrid } from "@/chartkit/prism";
import { colors, space, type } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import {
  fmtCount,
  fmtPct,
  fmtSignedPct,
  humanize,
  sectionUnavailable,
  toneForLabel,
} from "./format";
import { seasonalityRows } from "./signals";
import { Chip, SectionCard } from "./ui";

/**
 * Calendar-month seasonality for the ticker against its benchmarks, plus the
 * forward returns conditional on starting in this month.
 *
 * Sample sizes are printed next to every forward row on purpose: a 10-year
 * window is ten observations, and a hit rate off ten observations is a hint,
 * not a fact.
 */
export function SeasonalitySection({ packet }: { packet: PrismPacket }) {
  const seasonality = packet.seasonality;
  const unavailable = sectionUnavailable(packet, "seasonality", seasonality);
  const rows = seasonalityRows(seasonality, packet.ticker);
  const forward = seasonality?.ticker?.forward ?? null;
  const trend = seasonality?.ticker?.trend ?? null;

  return (
    <SectionCard
      eyebrow="Seasonality"
      title={`${seasonality?.month_label ?? "This month"} history`}
      subtitle="Mean return in this calendar month over each lookback. The bar under each value is the hit rate."
      unavailable={unavailable}
      right={
        trend?.direction ? (
          <Chip label={humanize(trend.direction)} tone={toneForLabel(trend.direction)} />
        ) : undefined
      }
    >
      <SeasonalityGrid rows={rows} />

      {forward ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.blockTitle}>
            Forward returns when {packet.ticker} starts in{" "}
            {seasonality?.month_label ?? "this month"}
          </Text>
          <View style={styles.headRow}>
            <Text style={[styles.cell, styles.head, styles.first]}>Horizon</Text>
            <Text style={[styles.cell, styles.head]}>Mean</Text>
            <Text style={[styles.cell, styles.head]}>Hit</Text>
            <Text style={[styles.cell, styles.head]}>p10</Text>
            <Text style={[styles.cell, styles.head]}>p90</Text>
            <Text style={[styles.cell, styles.head]}>n</Text>
          </View>
          {PRISM_HORIZONS.map((horizon) => {
            const stat = forward[horizon] ?? null;
            if (!stat) return null;
            const mean = typeof stat.mean === "number" ? stat.mean : null;
            return (
              <View key={horizon} style={styles.row}>
                <Text style={[styles.cell, styles.first]}>{horizon.toUpperCase()}</Text>
                <Text
                  style={[
                    styles.cell,
                    mean === null ? null : { color: mean >= 0 ? colors.accent : colors.danger },
                  ]}
                >
                  {fmtSignedPct(mean)}
                </Text>
                <Text style={styles.cell}>{fmtPct(stat.hit_rate, 0)}</Text>
                <Text style={[styles.cell, styles.dim]}>{fmtSignedPct(stat.p10)}</Text>
                <Text style={[styles.cell, styles.dim]}>{fmtSignedPct(stat.p90)}</Text>
                <Text style={[styles.cell, styles.dim]}>{fmtCount(stat.n)}</Text>
              </View>
            );
          })}
        </View>
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
  cell: { flex: 1, textAlign: "right", fontSize: 11.5, color: colors.fg, fontWeight: "600" },
  first: { flex: 1, textAlign: "left" },
  head: { color: colors.fgMuted, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.4 },
  dim: { color: colors.fgMuted, fontWeight: "400" },
});
