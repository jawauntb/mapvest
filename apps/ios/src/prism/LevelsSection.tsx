import type { PrismPacket } from "@/api/prism";
import { KeyLevelsChart } from "@/chartkit/prism";
import { colors } from "@/theme/tokens";
import { StyleSheet, Text } from "react-native";
import { sectionUnavailable } from "./format";
import { keyLevelRows } from "./signals";
import { SectionCard } from "./ui";

/**
 * Price levels from the analyzer's own builders — the auction value area, the
 * regression channel, and the ridge model — laid on one ladder against the
 * current price.
 */
export function LevelsSection({ packet }: { packet: PrismPacket }) {
  const levels = packet.levels;
  const unavailable = sectionUnavailable(packet, "levels", levels);
  const current =
    typeof packet.scenarios?.entry?.current_price === "number"
      ? packet.scenarios.entry.current_price
      : null;
  const rows = keyLevelRows(levels, current);

  return (
    <SectionCard
      eyebrow="Levels"
      title="Where price is"
      subtitle="Auction value area, regression channel, and model levels on one axis."
      unavailable={unavailable}
    >
      <KeyLevelsChart rows={rows} current={current} />
      {current === null ? (
        <Text style={styles.note}>
          No current price in this packet, so distances to each level are not shown.
        </Text>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  note: { color: colors.fgMuted, fontSize: 11.5, fontStyle: "italic", lineHeight: 17 },
});
