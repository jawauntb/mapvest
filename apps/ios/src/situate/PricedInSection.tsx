import type { SituatePacket } from "@/api/situate";
import { colors, radii, space } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { fmtMultiple, fmtNumber, fmtPct } from "./format";
import { pricedInRows, sectionUnavailable } from "./signals";
import { SectionCard, toneFg } from "./ui";

/**
 * What's priced in (SPEC 5.4): the options-vs-history disagreement per horizon.
 * `width_ratio` > 1 means the options price a wider move than history did in
 * this state; the 25Δ skew says which tail they are paying up for. This is the
 * market's own bull/bear, read off the smile rather than built from backward
 * history.
 */
export function PricedInSection({ packet }: { packet: SituatePacket }) {
  const implied = packet.implied;
  const unavailable = sectionUnavailable(packet, "implied", implied);
  const rows = pricedInRows(implied);

  return (
    <SectionCard
      eyebrow="Priced in"
      title="What the options are saying"
      unavailable={
        unavailable ?? (rows.length === 0 ? "no usable option expiries in this packet" : null)
      }
    >
      {rows.length > 0 ? (
        <>
          {rows.map((r) => {
            const wr = r.widthRatio;
            const tone =
              wr === null ? "neutral" : wr > 1.05 ? "bear" : wr < 0.95 ? "bull" : "neutral";
            return (
              <View key={r.horizon} style={styles.card}>
                <View style={styles.head}>
                  <Text style={styles.horizon}>{r.horizon}M</Text>
                  <Text style={[styles.ratio, { color: toneFg(tone) }]}>
                    width {fmtMultiple(r.widthRatio)}
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.meta}>ATM IV {fmtPct(r.ivAtm, 0)}</Text>
                  <Text style={styles.meta}>25Δ skew {fmtNumber(r.skew25d, 2)}</Text>
                </View>
                {r.note ? <Text style={styles.note}>{r.note}.</Text> : null}
              </View>
            );
          })}
          <Text style={styles.foot}>
            Width ratio compares the implied inter-quartile move to the historical conditional band;
            above 1 the market pays up for a bigger move than history alone would price.
          </Text>
        </>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgSunken,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: 4,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  horizon: { color: colors.fg, fontSize: 13, fontWeight: "800" },
  ratio: { fontSize: 13, fontWeight: "800" },
  metaRow: { flexDirection: "row", gap: space.lg },
  meta: { color: colors.fgMuted, fontSize: 11.5 },
  note: { color: colors.fgMuted, fontSize: 12, lineHeight: 17 },
  foot: { color: colors.fgMuted, fontSize: 11.5, lineHeight: 17 },
});
