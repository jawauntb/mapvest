import { colors, radii, type as typography } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { type JevMateriality, materialityLabel } from "@/util/materiality";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * "Material · 82%" pill for a Jev-scored headline. Renders nothing for an
 * unscored item — callers pass `materialityOf(item)` and let `null` fall
 * through, so a Jev outage leaves the feed looking exactly as it did before.
 *
 * Same pill geometry as the provider pill in TickerNewsSection; only the
 * material level gets the accent so the eye lands on what matters.
 */
export function MaterialityBadge({ tag }: { tag: JevMateriality | null | undefined }) {
  if (!tag) return null;
  const material = tag.level === "material";
  const noise = tag.level === "noise";
  return (
    <View
      style={[styles.pill, material && styles.pillMaterial, noise && styles.pillNoise]}
      accessible
      accessibilityLabel={`Materiality: ${materialityLabel(tag)}`}
    >
      <Text
        style={[
          styles.pillText,
          material && styles.pillTextMaterial,
          noise && styles.pillTextNoise,
        ]}
      >
        {materialityLabel(tag)}
      </Text>
    </View>
  );
}

/**
 * "Material only" toggle chip. Callers mount it only when `hasAnyScored(items)`
 * — with nothing scored there is nothing to filter, and showing a switch that
 * does nothing would read as broken.
 */
export function MaterialOnlyToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Pressable
      onPress={() => {
        hapticSelect();
        onChange(!value);
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel="Material only"
      hitSlop={6}
      style={({ pressed }) => [
        styles.toggle,
        value && styles.toggleOn,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.toggleText, value && styles.toggleTextOn]}>Material only</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    backgroundColor: colors.bgSunken,
    paddingHorizontal: 7,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  pillMaterial: { borderColor: colors.accentMuted, backgroundColor: "rgba(20, 196, 166, 0.14)" },
  pillNoise: { borderColor: colors.border },
  pillText: { ...typography.caption, fontSize: 10, lineHeight: 13, color: colors.fgMuted },
  pillTextMaterial: { color: colors.accent },
  pillTextNoise: { color: colors.fgDim },
  toggle: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    backgroundColor: colors.bgSunken,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  toggleOn: { borderColor: colors.accent, backgroundColor: colors.accentMuted },
  toggleText: { ...typography.caption, color: colors.fgMuted },
  toggleTextOn: { color: colors.fg },
});
