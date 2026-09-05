import type { SituatePacket } from "@/api/situate";
import { colors, space } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { caveats } from "./signals";
import { KeyValueRow, SectionCard } from "./ui";

/**
 * Confidence + caveats (SPEC §6.9): the effective sample sizes, the shrink
 * weights, whether the cross-sectional stack published its gates, and the
 * stated data gaps (revisions/PEAD, unreachable sources). This is what makes
 * the memo answerable instead of oracular — it is always rendered, so a packet
 * with holes never looks whole.
 */
export function ConfidenceSection({ packet }: { packet: SituatePacket }) {
  const rows = caveats(packet);
  return (
    <SectionCard
      eyebrow="Confidence"
      title="What to trust, and what's missing"
      unavailable={rows.length === 0 ? "no confidence metadata in this packet" : null}
    >
      {rows.length > 0 ? (
        <>
          {rows.map((row) => (
            <KeyValueRow key={`${row.label}-${row.value}`} label={row.label} value={row.value} />
          ))}
          <Text style={styles.note}>
            Small breadth means small edge: every conditional number is shrunk toward its base rate,
            and a failed gate drops the stack rather than shipping a confident guess.
          </Text>
        </>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  note: { color: colors.fgMuted, fontSize: 11.5, lineHeight: 17, marginTop: space.xs },
});
