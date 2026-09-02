import type { PrismPacket } from "@/api/prism";
import { CorrelationHeatmap } from "@/chartkit/prism";
import { colors, space, type } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { fmtNumber, fmtPct, humanize, sectionUnavailable, toneForLabel } from "./format";
import { relationalRows } from "./signals";
import { Chip, KeyValueRow, SectionCard } from "./ui";

/**
 * How this ticker moves with everything else, in the packet's gauge-fixed
 * frame: every series is expressed as excess over SPY and z-scored per window
 * before being compared, so a correlation here is frame-invariant rather than
 * an artifact of both legs drifting with the market.
 *
 * The kinematics arrow adds motion to the static correlation: velocity is the
 * mean 21-day log return, acceleration its change.
 */
export function RelationalSection({ packet }: { packet: PrismPacket }) {
  const relational = packet.relational;
  const unavailable = sectionUnavailable(packet, "relational", relational);
  const rows = relationalRows(relational);
  const rma = relational?.relative_moving_average ?? null;
  const impact = Object.entries(relational?.impact_weights ?? {})
    .map(([symbol, value]) => ({ symbol, weight: value?.weight ?? null }))
    .filter((r): r is { symbol: string; weight: number } => typeof r.weight === "number")
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  return (
    <SectionCard
      eyebrow="Relational"
      title="Correlation, beta, motion"
      subtitle={
        relational?.reference_frame
          ? `Reference frame: ${humanize(relational.reference_frame)}.`
          : "Correlation and beta against the benchmark universe."
      }
      unavailable={unavailable}
      right={
        rma?.signal ? (
          <Chip label={humanize(rma.signal)} tone={toneForLabel(rma.signal)} />
        ) : undefined
      }
    >
      <CorrelationHeatmap rows={rows} />

      {rma ? (
        <KeyValueRow
          label="Relative moving average"
          value={`${fmtNumber(rma.value, 2)}${rma.signal ? ` · ${humanize(rma.signal)}` : ""}`}
          tone={toneForLabel(rma.signal)}
        />
      ) : null}

      {impact.length > 0 ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.blockTitle}>Largest explanatory weights</Text>
          {impact.map((row) => (
            <KeyValueRow key={row.symbol} label={row.symbol} value={fmtPct(row.weight, 1)} />
          ))}
        </View>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  blockTitle: { color: colors.fgMuted, ...type.label, marginTop: space.xs },
});
