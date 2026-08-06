import { colors, motion, radii } from "@/theme/tokens";
import { hapticTap } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Universal "Chat about this" affordance — an Ionicons
 * `chatbubble-ellipses-outline` glyph in a soft elevated pill, optionally
 * with a short label. Sibling of ShareButton — same visual family and
 * spring feel — so it slots naturally beside share/star in card headers.
 *
 * The button is dumb: it just calls `onPress`. Wire it to `openChatAbout`
 * in `@/nav/chatAbout` at the callsite so the seed is composed in-place
 * where the context (ticker, brief, list, map) actually lives.
 */
export function ChatAboutButton({
  onPress,
  label,
  style,
  accessibilityLabel,
}: {
  onPress: () => void;
  /** Optional label — omit for icon-only. */
  label?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      onPress={() => {
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
      accessibilityLabel={accessibilityLabel ?? label ?? "Chat about this"}
      hitSlop={8}
      style={[animStyle, styles.btn, label ? styles.btnWithLabel : styles.btnIconOnly, style]}
    >
      <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.accent} />
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
});
