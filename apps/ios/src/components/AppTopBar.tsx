import { useSidebar } from "@/nav/SidebarContext";
import { colors, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Fixed top chrome: burger always opens the drawer so every screen can
 * get home / map / camera. Optional `leading` sits next to the burger
 * (e.g. a Chats back). `right` is New / camera / etc.
 */
export function AppTopBar({
  title,
  leading,
  right,
}: {
  title: string;
  leading?: ReactNode;
  right?: ReactNode;
}) {
  const { openSidebar } = useSidebar();
  return (
    <View style={styles.bar}>
      <View style={styles.side}>
        <Pressable
          onPress={() => {
            hapticSelect();
            openSidebar();
          }}
          hitSlop={12}
          style={styles.burger}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <Ionicons name="menu-outline" size={22} color={colors.fg} />
        </Pressable>
        {leading}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.side, styles.sideRight]}>{right ?? <View style={styles.spacer} />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
    minHeight: 48,
    gap: 8,
  },
  side: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 44,
    gap: 4,
  },
  sideRight: { justifyContent: "flex-end" },
  burger: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElevated,
  },
  title: {
    flex: 1,
    color: colors.fg,
    ...type.h2,
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  spacer: { width: 40, height: 40 },
});
