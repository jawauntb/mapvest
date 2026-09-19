import type { RatingResponse } from "@/api/client";
import { colors, radii, type as typography } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { driverLine, ratingChipLabel, ratingTone, sourceLabel } from "@/util/rating";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

/**
 * The hero rating chip at the top of Investable: a colored pill ("BUY · 72%")
 * that expands on tap into the drivers, the evidence sources it was built
 * from, and the disclaimer. Renders the muted "Not enough signal yet" pill
 * when the API answers `insufficient_signal`, and nothing at all while the
 * first fetch is in flight or after an error — a missing rating must never
 * push the header around or read as a failure.
 *
 * Same pill geometry as `MaterialityBadge`; the tone (accent / danger /
 * muted) follows the action so the eye reads direction before the word.
 */
export function RatingChip({
  rating,
  loading,
}: {
  rating: RatingResponse | null | undefined;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!rating) {
    if (!loading) return null;
    return (
      <View style={[styles.pill, styles.pillMuted]} accessibilityLabel="Rating loading">
        <ActivityIndicator size="small" color={colors.fgDim} />
        <Text style={[styles.pillText, styles.pillTextMuted]}>Rating…</Text>
      </View>
    );
  }
  const label = ratingChipLabel(rating);
  const tone = ratingTone(rating);
  const toneStyle =
    tone === "up"
      ? styles.pillUp
      : tone === "down"
        ? styles.pillDown
        : tone === "neutral"
          ? styles.pillNeutral
          : styles.pillMuted;
  const textStyle =
    tone === "up"
      ? styles.pillTextUp
      : tone === "down"
        ? styles.pillTextDown
        : tone === "neutral"
          ? styles.pillTextNeutral
          : styles.pillTextMuted;

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => {
          hapticSelect();
          setOpen((v) => !v);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={
          label ? `Rating ${label}. ${rating.rating?.one_line ?? ""}` : "Not enough signal yet"
        }
        hitSlop={6}
        style={({ pressed }) => [styles.pill, toneStyle, pressed && { opacity: 0.75 }]}
      >
        <Text style={[styles.pillText, textStyle]}>{label ?? "Not enough signal yet"}</Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={12}
          color={tone === "muted" ? colors.fgDim : colors.fgMuted}
        />
      </Pressable>
      {label && rating.rating?.one_line ? (
        <Text style={styles.oneLine} numberOfLines={2}>
          {rating.rating.one_line}
        </Text>
      ) : null}

      {open ? (
        <View style={styles.panel}>
          {rating.drivers.length > 0 ? (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Drivers</Text>
              {rating.drivers.map((d) => (
                <Text key={d.name} style={styles.row}>
                  {driverLine(d)}
                </Text>
              ))}
            </View>
          ) : null}
          {rating.evidence.length > 0 ? (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Evidence</Text>
              {rating.evidence.map((e) => (
                <View key={e.source} style={styles.evidenceRow}>
                  <Text style={styles.evidenceSource}>{sourceLabel(e.source)}</Text>
                  <Text style={styles.evidenceSummary} numberOfLines={3}>
                    {e.summary}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.row}>
              {rating.status === "insufficient_signal"
                ? "Fewer than two evidence sources resolved for this ticker, so no rating is shown."
                : "No evidence sources recorded."}
            </Text>
          )}
          <Text style={styles.disclaimer}>{rating.disclaimer}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, alignItems: "flex-start" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  pillText: { ...typography.caption, fontSize: 12, fontWeight: "800", letterSpacing: 0.4 },
  pillUp: { borderColor: colors.accent, backgroundColor: "rgba(20, 196, 166, 0.16)" },
  pillTextUp: { color: colors.accent },
  pillDown: { borderColor: colors.danger, backgroundColor: "rgba(232, 93, 93, 0.16)" },
  pillTextDown: { color: colors.danger },
  pillNeutral: { borderColor: colors.warn, backgroundColor: "rgba(232, 160, 84, 0.14)" },
  pillTextNeutral: { color: colors.warn },
  pillMuted: { borderColor: colors.border, backgroundColor: colors.bgSunken },
  pillTextMuted: { color: colors.fgDim, fontWeight: "600", letterSpacing: 0 },
  oneLine: { color: colors.fgMuted, fontSize: 13, lineHeight: 18 },
  panel: {
    alignSelf: "stretch",
    gap: 10,
    padding: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  block: { gap: 4 },
  blockTitle: { ...typography.caption, color: colors.fgDim, textTransform: "uppercase" },
  row: { color: colors.fg, fontSize: 13, lineHeight: 18 },
  evidenceRow: { gap: 1 },
  evidenceSource: { color: colors.fg, fontSize: 13, fontWeight: "600" },
  evidenceSummary: { color: colors.fgMuted, fontSize: 12, lineHeight: 16 },
  disclaimer: { color: colors.fgDim, fontSize: 11, lineHeight: 15 },
});
