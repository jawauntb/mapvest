import type { SituatePacket } from "@/api/situate";
import { QuantileFan } from "@/chartkit/situate";
import { colors, radii, space } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { fmtPct, fmtSignedPct } from "./format";
import { type FanPoint, fanPoints, sectionUnavailable } from "./signals";
import { SectionCard, toneFg } from "./ui";

/**
 * The odds by horizon (SPEC 5.3 / 5.4, merged): the quantile fan with the
 * empirical base-rate band and the options-implied band overlaid, plus a P(up)
 * row that always shows the base rate beside the merged median — a conditional
 * number without its base rate is the thing this product exists to avoid.
 */
export function OddsSection({ packet }: { packet: SituatePacket }) {
  // The fan reads odds + base_rates + implied together, so it is "unavailable"
  // only when all three are gone.
  const unavailable =
    sectionUnavailable(packet, "odds", packet.odds) &&
    sectionUnavailable(packet, "base_rates", packet.base_rates) &&
    sectionUnavailable(packet, "implied", packet.implied)
      ? sectionUnavailable(packet, "odds", packet.odds)
      : null;
  const fan = fanPoints(packet);
  // Extreme P(up) off a tiny effective sample (e.g. 93% at 12m, 100% at 18m) is
  // an artifact of a short, trending history — the memo hedges these, so the
  // table marks and mutes them rather than letting a bare "100%" read as near
  // certainty.
  const hasSmallN = fan.some((p) => p.pUp !== null && p.nEff !== null && p.nEff < SMALL_N_EFF);

  return (
    <SectionCard
      eyebrow="Odds"
      title="The distribution by horizon"
      subtitle="Base rate beside every conditional number."
      unavailable={fan.length === 0 ? (unavailable ?? "no per-horizon odds in this packet") : null}
    >
      {fan.length > 0 ? (
        <>
          <QuantileFan fan={fan} />
          <View style={styles.rows}>
            <View style={[styles.row, styles.headerRow]}>
              <Text style={[styles.cell, styles.head, styles.hCol]}>Horizon</Text>
              <Text style={[styles.cell, styles.head]}>Median</Text>
              <Text style={[styles.cell, styles.head]}>Base rate</Text>
              <Text style={[styles.cell, styles.head]}>P(up)</Text>
            </View>
            {fan.map((p) => (
              <PUpRow key={p.horizon} p={p} />
            ))}
          </View>
          <Text style={styles.note}>
            The merged median blends the shrunk base rate with the options-implied read; P(up) and
            the base-rate median sit beside it so the conditional call is always graded against
            history.
          </Text>
          {hasSmallN ? (
            <Text style={styles.note}>
              * small effective sample; treat extreme P(up) as an artifact of a short, trending
              history, not a certainty.
            </Text>
          ) : null}
        </>
      ) : null}
    </SectionCard>
  );
}

/** Below this effective sample (n/h), a P(up) is flagged as small-n. */
export const SMALL_N_EFF = 6;

function PUpRow({ p }: { p: FanPoint }) {
  const median = p.odds?.q50 ?? p.hist?.q50 ?? null;
  const tone = median === null ? "neutral" : median > 0 ? "bull" : median < 0 ? "bear" : "neutral";
  const smallN = p.pUp !== null && p.nEff !== null && p.nEff < SMALL_N_EFF;
  const pUpText = p.pUp === null ? fmtPct(p.pUp, 0) : `${fmtPct(p.pUp, 0)}${smallN ? "*" : ""}`;
  return (
    <View style={styles.row}>
      <Text style={[styles.cell, styles.hCol, styles.horizon]}>{p.horizon}M</Text>
      <Text style={[styles.cell, { color: toneFg(tone), fontWeight: "700" }]}>
        {fmtSignedPct(median, 1)}
      </Text>
      <Text style={styles.cell}>{fmtSignedPct(p.baseRateQ50, 1)}</Text>
      <Text style={[styles.cell, smallN ? styles.muted : null]}>{pUpText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rows: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerRow: { backgroundColor: colors.bgSunken },
  cell: { flex: 1, color: colors.fg, fontSize: 12, textAlign: "right" },
  hCol: { textAlign: "left" },
  head: { color: colors.fgMuted, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.3 },
  horizon: { color: colors.fgMuted, fontWeight: "700" },
  muted: { color: colors.fgMuted },
  note: { color: colors.fgMuted, fontSize: 11.5, lineHeight: 17 },
});
