import { colors, type } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * View-based empty-state illustration — a soft ringed icon badge instead of
 * an emoji. Used for watchlist / research / list empty states.
 */
export function EmptyState({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.root}>
      <View style={styles.ringOuter}>
        <View style={styles.ringInner}>
          <Ionicons name={icon} size={30} color={colors.fgMuted} />
        </View>
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { padding: 28, alignItems: "center", gap: 12 },
  ringOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  ringInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.bgSunken,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: colors.fg, ...type.h3, textAlign: "center" },
  subtitle: {
    color: colors.fgMuted,
    ...type.body,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
    maxWidth: 280,
  },
});
