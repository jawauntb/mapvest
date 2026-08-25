import { colors, motion, radii } from "@/theme/tokens";
import { hapticTap } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Compact share affordance — an Ionicons `share-outline` glyph in a soft
 * elevated pill, optionally with a short label. Meant to sit next to the
 * Mapvest Daily eyebrow or in a research sheet toolbar.
 *
 * Uses the ScalePressable-style spring so it feels consistent with the rest
 * of Home; not a gradient CTA — we reserve that for primary actions.
 */
export function ShareButton({
  onPress,
  label,
  style,
  accessibilityLabel,
  busy = false,
  disabled = false,
}: {
  onPress: () => void;
  /** Optional label — omit for icon-only. */
  label?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
  /** Shows a spinner and blocks duplicate native share sheets. */
  busy?: boolean;
  disabled?: boolean;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const isDisabled = disabled || busy;

  return (
    <AnimatedPressable
      disabled={isDisabled}
      onPress={() => {
        if (isDisabled) return;
        hapticTap();
        onPress();
      }}
      onPressIn={() => {
        scale.value = withSpring(0.94, motion.springSnappy);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, motion.springSnappy);
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label ?? "Share"}
      accessibilityState={{ disabled: isDisabled, busy }}
      hitSlop={8}
      style={[
        animStyle,
        styles.btn,
        label ? styles.btnWithLabel : styles.btnIconOnly,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <Ionicons name="share-outline" size={16} color={colors.accent} />
      )}
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  btnIconOnly: {
    width: 32,
    height: 32,
  },
  btnWithLabel: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  label: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  disabled: {
    opacity: 0.65,
  },
});
