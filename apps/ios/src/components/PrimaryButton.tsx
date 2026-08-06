import { LinearGradient } from "expo-linear-gradient";
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { colors, motion, radii, type } from "@/theme/tokens";
import { hapticTap } from "@/util/haptics";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Signature gradient CTA (jade → blue). Reserve for one primary action per
 * screen — Sign in, capture confirm, Save watchlist, etc.
 */
export function PrimaryButton({
  label,
  onPress,
  busy,
  disabled,
  icon,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const isDisabled = disabled || busy;

  return (
    <AnimatedPressable
      onPress={() => {
        if (isDisabled) return;
        hapticTap();
        onPress();
      }}
      onPressIn={() => {
        if (isDisabled) return;
        scale.value = withSpring(0.96, motion.springSnappy);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, motion.springSnappy);
      }}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy }}
      style={[animStyle, isDisabled && { opacity: 0.55 }, style]}
    >
      <LinearGradient
        colors={colors.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.grad}
      >
        {busy ? (
          <ActivityIndicator color={colors.accentInk} />
        ) : (
          <>
            {icon}
            <Text style={styles.text}>{label}</Text>
          </>
        )}
      </LinearGradient>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  grad: {
    minHeight: 48,
    borderRadius: radii.lg,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  text: { color: colors.accentInk, ...type.label, fontSize: 15, fontWeight: "800" },
});
