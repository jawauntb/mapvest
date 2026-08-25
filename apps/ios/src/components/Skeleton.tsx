import { colors, radii } from "@/theme/tokens";
import { useEffect } from "react";
import { type DimensionValue, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

/**
 * Soft pulsing placeholder — replaces bare ActivityIndicator spinners for
 * list/card loading states. No neon glow: opacity pulse only.
 */
export function Skeleton({
  width = "100%",
  height = 14,
  radius = radii.sm,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: ViewStyle;
}) {
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.bgElevated },
        animStyle,
        style,
      ]}
    />
  );
}

/** Skeleton row matching the watchlist / list-screen row layout. */
export function SkeletonRow() {
  return (
    <View style={styles.row}>
      <Skeleton width={34} height={34} radius={17} />
      <View style={{ flex: 1, gap: 6 }}>
        <Skeleton width="55%" height={14} />
        <Skeleton width="35%" height={11} />
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <Skeleton width={54} height={14} />
        <Skeleton width={36} height={11} />
      </View>
    </View>
  );
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  const rowKeys = Array.from({ length: rows }, (_, row) => `skeleton-row-${row + 1}`);

  return (
    <View style={{ paddingHorizontal: 16, gap: 2 }}>
      {rowKeys.map((key) => (
        <SkeletonRow key={key} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
  },
});
