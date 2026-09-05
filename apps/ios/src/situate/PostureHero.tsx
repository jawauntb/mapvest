import type { SituatePacket } from "@/api/situate";
import { colors, fonts, radii, space, type } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import {
  convictionLabel,
  fmtMoneyCompact,
  fmtPct,
  isPacketStale,
  postureHorizon,
  relativeAge,
  stanceLabel,
  stanceTone,
} from "./format";
import { Chip, Meter, toneFg } from "./ui";

/**
 * The hero: the company, the posture, and the conviction — and nothing that
 * reads as buy/sell. The posture chip is the whole call ("odds favorable at
 * 3m"), the meter shows conviction, and the one-liner is the thesis. A stale
 * packet says so, because every price below the fold is the close it was built
 * from.
 */
export function PostureHero({ packet }: { packet: SituatePacket }) {
  const profile = packet.profile;
  const posture = packet.memo?.posture ?? null;
  const stance = posture?.stance ?? null;
  const tone = stanceTone(stance);
  const conviction = typeof posture?.conviction === "number" ? posture.conviction : null;
  const stale = isPacketStale(packet.generated_at);

  const descriptors = [profile?.sector, profile?.industry].filter(Boolean).join(" · ");

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.brand}>SITUATE</Text>
          <Text style={styles.ticker}>{packet.ticker}</Text>
          {profile?.name ? (
            <Text style={styles.name} numberOfLines={1}>
              {profile.name}
            </Text>
          ) : null}
          {descriptors ? <Text style={styles.descriptors}>{descriptors}</Text> : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          {stance ? (
            <Chip
              label={`${stanceLabel(stance)}${
                postureHorizon(posture?.horizon) ? ` · ${postureHorizon(posture?.horizon)}` : ""
              }`}
              tone={tone}
              solid
            />
          ) : (
            <Chip label="No posture" tone="neutral" />
          )}
          {profile?.market_cap ? (
            <Text style={styles.cap}>{fmtMoneyCompact(profile.market_cap)}</Text>
          ) : null}
        </View>
      </View>

      {posture?.one_line ? <Text style={styles.oneLine}>{posture.one_line}</Text> : null}

      {conviction !== null ? (
        <View style={{ gap: 5 }}>
          <View style={styles.convRow}>
            <Text style={styles.convLabel}>{convictionLabel(conviction)}</Text>
            <Text style={[styles.convValue, { color: toneFg(tone) }]}>{fmtPct(conviction, 0)}</Text>
          </View>
          <Meter value={conviction} tone={tone} height={7} />
        </View>
      ) : null}

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>
          as of {packet.as_of}
          {packet.generated_at ? ` · built ${relativeAge(packet.generated_at)}` : ""}
        </Text>
        {stale ? (
          <View style={styles.staleChip}>
            <Ionicons name="time-outline" size={11} color={colors.warn} />
            <Text style={styles.staleText}>prices may be stale</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.disclaimer}>
        A posture on the odds, not a buy/sell call. No point price targets. Research only.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: space.lg,
    gap: space.md,
  },
  topRow: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  brand: {
    color: colors.accent,
    fontFamily: fonts.display,
    fontSize: 12,
    letterSpacing: 1.6,
  },
  ticker: { color: colors.fg, ...type.h1 },
  name: { color: colors.fg, fontSize: 14, fontWeight: "600" },
  descriptors: { color: colors.fgMuted, fontSize: 12 },
  cap: { color: colors.fgMuted, fontSize: 12, fontWeight: "700" },
  oneLine: { color: colors.fg, fontFamily: fonts.serif, fontSize: 15.5, lineHeight: 23 },
  convRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  convLabel: { color: colors.fgMuted, ...type.label },
  convValue: { fontSize: 13, fontWeight: "800" },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  metaText: { color: colors.fgMuted, fontSize: 11 },
  staleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderColor: colors.warn,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  staleText: { color: colors.warn, fontSize: 10.5, fontWeight: "700" },
  disclaimer: { color: colors.fgMuted, fontSize: 10.5, lineHeight: 15 },
});
