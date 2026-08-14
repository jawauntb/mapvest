import { Image, StyleSheet, type ImageStyle, type StyleProp } from "react-native";

/**
 * The real Mapvest mark — black field, teal pin, white tape line.
 * Same asset as the home-screen icon. Do not substitute a gradient + pin.
 */
export function BrandMark({
  size = 28,
  style,
}: {
  size?: number;
  style?: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      source={require("../../assets/icon.png")}
      style={[styles.img, { width: size, height: size, borderRadius: size * 0.22 }, style]}
      accessibilityIgnoresInvertColors
      accessibilityLabel="Mapvest"
    />
  );
}

const styles = StyleSheet.create({
  img: { backgroundColor: "#0C0E10" },
});
