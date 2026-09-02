import type { PrismPacket, PrismRecentWindow } from "@/api/prism";
import { colors, space, type } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import {
  fmtNumber,
  fmtPct,
  fmtSignedPct,
  humanize,
  sectionUnavailable,
  toneForValue,
} from "./format";
import { SectionCard, StatTile } from "./ui";

function WindowRow({ label, window }: { label: string; window: PrismRecentWindow | null }) {
  if (!window) return null;
  return (
    <View style={{ gap: space.sm }}>
      <Text style={styles.blockTitle}>{label}</Text>
      <View style={styles.tiles}>
        <StatTile
          label="Return"
          value={fmtSignedPct(window.return)}
          tone={toneForValue(window.return)}
        />
        <StatTile
          label="vs SPY"
          value={fmtSignedPct(window.vs_spy)}
          tone={toneForValue(window.vs_spy)}
        />
        <StatTile
          label="vs sector"
          value={fmtSignedPct(window.vs_sector)}
          tone={toneForValue(window.vs_sector)}
        />
      </View>
      <View style={styles.tiles}>
        <StatTile label="Vol (ann.)" value={fmtPct(window.volatility, 1)} />
        <StatTile label="Entropy" value={fmtNumber(window.entropy, 2)} />
        <StatTile label="Regime" value={humanize(window.regime, "—")} />
      </View>
      {window.notable ? <Text style={styles.notable}>{window.notable}</Text> : null}
    </View>
  );
}

/** The last month and quarter in the ticker's own terms, and against its peers. */
export function RecentSection({ packet }: { packet: PrismPacket }) {
  const recent = packet.recent;
  const unavailable = sectionUnavailable(packet, "recent", recent);
  return (
    <SectionCard
      eyebrow="Recent"
      title="The tape lately"
      subtitle="How the last twenty and sixty sessions actually went."
      unavailable={unavailable}
    >
      {!unavailable && !recent?.last_20d && !recent?.last_60d ? (
        <Text style={styles.note}>
          The engine returned this section without either window — not enough recent sessions to
          measure.
        </Text>
      ) : null}
      <WindowRow label="Last 20 sessions" window={recent?.last_20d ?? null} />
      <WindowRow label="Last 60 sessions" window={recent?.last_60d ?? null} />
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", gap: space.sm },
  blockTitle: { color: colors.fgMuted, ...type.label },
  notable: { color: colors.fgMuted, fontSize: 12.5, lineHeight: 18 },
  note: { color: colors.fgMuted, fontSize: 12, fontStyle: "italic", lineHeight: 17 },
});
