import { Pressable, type PressableProps } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { motion } from "@/theme/tokens";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Pressable with a soft scale-down spring on press — used for cards, rows,
 * and icon buttons that aren't the signature gradient CTA.
 */
export function ScalePressable({
  children,
  style,
  scaleTo = 0.97,
  ...rest
}: PressableProps & { scaleTo?: number }) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, motion.springSnappy);
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, motion.springSnappy);
        rest.onPressOut?.(e);
      }}
      style={[animStyle, style as never]}
    >
      {children}
    </AnimatedPressable>
  );
}
