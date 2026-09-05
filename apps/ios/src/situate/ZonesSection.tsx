import type { SituatePacket } from "@/api/situate";
import { ZonesChart, zoneDistanceNote } from "@/chartkit/situate";
import { colors, space } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { fmtPrice } from "./format";
import { levelRows, sectionUnavailable, zones } from "./signals";
import { SectionCard, toneFg } from "./ui";

/**
 * Cheap/rich zones on the price ladder (SPEC 5.8). The zones are the price at
 * the 25th/75th implied quantile — a band with the uncertainty in its width,
 * never a point target — laid over the auction levels and moving averages.
 */
export function ZonesSection({ packet }: { packet: SituatePacket }) {
  const levels = packet.levels;
  const unavailable = sectionUnavailable(packet, "levels", levels);
  const rows = levelRows(levels);
  const zoneRows = zones(levels);
  const current = typeof levels?.current_price === "number" ? levels.current_price : null;

  return (
    <SectionCard eyebrow="Zones" title="Cheap / rich zones" unavailable={unavailable}>
      {levels ? (
        <>
          <ZonesChart rows={rows} zones={zoneRows} current={current} />
          {zoneRows.map((z) => {
            const note = zoneDistanceNote(z, current);
            return (
              <View key={z.kind} style={styles.zoneRow}>
                <Text
                  style={[
                    styles.zoneLabel,
                    { color: toneFg(z.kind === "cheap" ? "bull" : "bear") },
                  ]}
                >
                  {z.kind === "cheap" ? "Cheap zone" : "Rich zone"}
                  {z.horizon ? ` (${z.horizon}m)` : ""}
                </Text>
                <Text style={styles.zoneValue}>
                  {fmtPrice(z.lo)}–{fmtPrice(z.hi)}
                  {note ? ` · ${note}` : ""}
                </Text>
              </View>
            );
          })}
          <Text style={styles.note}>
            Zones are the price at the 25th/75th implied quantile — a band, not a target. The data
            suggests where the odds tilt, not where the price will land.
          </Text>
        </>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  zoneRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: 4,
  },
  zoneLabel: { fontSize: 12.5, fontWeight: "800" },
  zoneValue: { color: colors.fg, fontSize: 12.5, fontWeight: "600" },
  note: { color: colors.fgMuted, fontSize: 11.5, lineHeight: 17 },
});
