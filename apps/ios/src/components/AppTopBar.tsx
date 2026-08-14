import { useSidebar } from "@/nav/SidebarContext";
import { colors, fonts, space, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Fixed top chrome: burger always opens the drawer so every screen can
 * get home / map / camera. Optional `leading` sits next to the burger
 * (e.g. a Chats back). `right` is New / camera / etc.
 * `brandTitle` renders the title in the Syne display face — wordmark
 * moments only (Home), never plain screen names.
 */
export function AppTopBar({
  title,
  leading,
  right,
  brandTitle,
}: {
  title: string;
  leading?: ReactNode;
  right?: ReactNode;
  brandTitle?: boolean;
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
      <Text
        style={[styles.title, brandTitle && styles.brandTitle]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
      >
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
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    minHeight: 48,
    gap: space.sm,
  },
  side: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 44,
    gap: space.xs,
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
  brandTitle: {
    fontFamily: fonts.display,
    fontSize: 19,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  spacer: { width: 40, height: 40 },
});
