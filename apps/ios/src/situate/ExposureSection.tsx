import type { SituatePacket } from "@/api/situate";
import { ExposureBars } from "@/chartkit/situate";
import { colors, space } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { fmtPct } from "./format";
import { exposureBars, sectionUnavailable } from "./signals";
import { SectionCard, StatTile } from "./ui";

/**
 * What you're buying (SPEC 5.1): the basket betas as diverging bars with their
 * 12-month change, plus R², idiosyncratic share, and residual vol as the "how
 * much of this is the stock itself" readout.
 */
export function ExposureSection({ packet }: { packet: SituatePacket }) {
  const exposure = packet.exposure;
  const unavailable = sectionUnavailable(packet, "exposure", exposure);
  const bars = exposureBars(exposure);

  return (
    <SectionCard
      eyebrow="Exposure"
      title="What you're buying"
      subtitle={exposure?.method ? `Method: ${exposure.method}` : undefined}
      unavailable={unavailable}
    >
      {exposure ? (
        <>
          <View style={styles.tiles}>
            <StatTile label="R²" value={fmtPct(exposure.r2, 0)} />
            <StatTile
              label="Idiosyncratic"
              value={fmtPct(exposure.idiosyncratic_share, 0)}
              sub="of variance"
            />
            <StatTile
              label="Residual vol"
              value={fmtPct(exposure.residual_vol_annual, 0)}
              sub="annualized"
            />
          </View>
          <ExposureBars bars={bars} />
          <Text style={styles.note}>
            Betas are EWMA-ridge weighted (24-month half-life); the 12-month change shows what the
            stock is becoming more or less of, not a one-off move.
          </Text>
        </>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", gap: space.sm },
  note: { color: colors.fgMuted, fontSize: 11.5, lineHeight: 17 },
});
