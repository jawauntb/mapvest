import { type AgentThread, listAgentThreads } from "@/api/client";
import { useSession } from "@/auth/session";
import { useSidebar } from "@/nav/SidebarContext";
import { colors, elevation, motion, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PANEL_WIDTH = Math.min(340, Dimensions.get("window").width * 0.82);

/**
 * ChatGPT-style left drawer — watchlist, research chats, settings/home,
 * ticker search entry. Slide + fade with a snappy spring; swipe-left or tap
 * the scrim to dismiss. Keeps the bottom tab bar slim.
 */
export function AppSidebar() {
  const { open, closeSidebar } = useSidebar();
  const router = useRouter();
  const { session, user } = useSession();
  const insets = useSafeAreaInsets();

  // Modal stays mounted through the close animation, then unmounts.
  const [mounted, setMounted] = useState(open);
  const tx = useSharedValue(-PANEL_WIDTH);
  const scrimOpacity = useSharedValue(0);

  useEffect(() => {
    if (open) {
      setMounted(true);
      tx.value = withSpring(0, motion.springSnappy);
      scrimOpacity.value = withTiming(1, { duration: 220 });
    } else {
      tx.value = withSpring(-PANEL_WIDTH, motion.springSoft);
      scrimOpacity.value = withTiming(0, { duration: 180 }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
  }, [open, tx, scrimOpacity]);

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrimOpacity.value }));

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onUpdate((e) => {
      tx.value = Math.min(0, Math.max(-PANEL_WIDTH, e.translationX));
    })
    .onEnd((e) => {
      const shouldClose = e.translationX < -PANEL_WIDTH * 0.3 || e.velocityX < -600;
      if (shouldClose) {
        runOnJS(closeSidebar)();
      } else {
        tx.value = withSpring(0, motion.springSnappy);
      }
    });

  const threadsQ = useQuery({
    queryKey: ["agent-threads", session?.token],
    queryFn: () => listAgentThreads({ token: session?.token }),
    enabled: open && !!session?.token,
    staleTime: 15_000,
  });
  const threads = (threadsQ.data?.threads ?? []).slice(0, 12);

  function go(path: string) {
    hapticSelect();
    closeSidebar();
    router.push(path as never);
  }

  if (!mounted) return null;

  return (
    <Modal visible={mounted} animationType="none" transparent onRequestClose={closeSidebar}>
      <View style={styles.root}>
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[
              styles.panel,
              elevation.lg,
              panelStyle,
              { width: PANEL_WIDTH, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 },
            ]}
          >
            <View style={styles.brandRow}>
              <View style={styles.brandMark}>
                <LinearGradient
                  colors={colors.gradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.brandMarkGrad}
                >
                  <Ionicons name="pin" size={16} color={colors.accentInk} />
                </LinearGradient>
                <Text style={styles.brand}>Mapvest</Text>
              </View>
              <Pressable
                onPress={closeSidebar}
                hitSlop={12}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close menu"
              >
                <Ionicons name="close" size={20} color={colors.fgMuted} />
              </Pressable>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 4, paddingBottom: 16 }}>
              <NavRow
                icon="home-outline"
                label="Home"
                hint="Watchlist · map · camera"
                onPress={() => go("/(tabs)/home")}
              />
              <NavRow
                icon="star-outline"
                label="Watchlist"
                hint="Saved tickers"
                onPress={() => go("/(tabs)/saved")}
              />
              <NavRow
                icon="sparkles-outline"
                label="New research"
                hint="Start a brief"
                onPress={() => go("/(tabs)/research?intent=new")}
              />
              <NavRow
                icon="search-outline"
                label="Find ticker"
                hint="Search by symbol"
                onPress={() => go("/(tabs)/home?focus=search")}
              />
              <NavRow
                icon="settings-outline"
                label="Settings"
                hint={user?.email ?? "Account · Robinhood MCP"}
                onPress={() => go("/(tabs)/settings")}
              />

              <Text style={styles.section}>Recent chats</Text>
              {!session?.token ? (
                <Text style={styles.muted}>Sign in to sync research threads.</Text>
              ) : threadsQ.isLoading ? (
                <Text style={styles.muted}>Loading…</Text>
              ) : threads.length === 0 ? (
                <Text style={styles.muted}>No briefs yet — start a new research chat.</Text>
              ) : (
                threads.map((t: AgentThread) => (
                  <Pressable
                    key={t.id}
                    style={styles.threadRow}
                    onPress={() => {
                      hapticSelect();
                      closeSidebar();
                      router.push(
                        `/(tabs)/research?intent=thread&id=${encodeURIComponent(t.id)}` as never,
                      );
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Open research thread: ${t.title || "Research"}`}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.fgDim} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.threadTitle} numberOfLines={1}>
                        {t.title || "Research"}
                      </Text>
                      {t.preview ? (
                        <Text style={styles.threadPreview} numberOfLines={1}>
                          {t.preview}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))
              )}
            </ScrollView>

            <Pressable
              style={({ pressed }) => [pressed && { opacity: 0.85 }]}
              onPress={() => go("/(tabs)/research?intent=new")}
              accessibilityRole="button"
              accessibilityLabel="Start new research chat"
            >
              <LinearGradient
                colors={colors.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.newChatBtn}
              >
                <Ionicons name="add" size={18} color={colors.accentInk} />
                <Text style={styles.newChatText}>New chat</Text>
              </LinearGradient>
            </Pressable>
          </Animated.View>
        </GestureDetector>
        <Animated.View
          style={[StyleSheet.absoluteFillObject, scrimStyle]}
          pointerEvents={open ? "auto" : "none"}
        >
          <Pressable
            style={styles.scrim}
            onPress={closeSidebar}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

function NavRow({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.navRow}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.navIcon}>
        <Ionicons name={icon} size={18} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.navLabel}>{label}</Text>
        {hint ? <Text style={styles.navHint}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row" },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  panel: {
    backgroundColor: colors.bgElevated,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingHorizontal: 16,
    gap: 8,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  brandMark: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandMarkGrad: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: { color: colors.fg, ...type.h2, fontSize: 20 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    color: colors.fgMuted,
    ...type.label,
    marginTop: 18,
    marginBottom: 6,
  },
  muted: { color: colors.fgDim, fontSize: 13, lineHeight: 18 },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: 44,
  },
  navIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    backgroundColor: colors.bgSunken,
    alignItems: "center",
    justifyContent: "center",
  },
  navLabel: { color: colors.fg, ...type.body, fontWeight: "600" },
  navHint: { color: colors.fgDim, fontSize: 12, marginTop: 1 },
  threadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    minHeight: 44,
  },
  threadTitle: { color: colors.fg, fontSize: 14, fontWeight: "500" },
  threadPreview: { color: colors.fgDim, fontSize: 12, marginTop: 1 },
  newChatBtn: {
    borderRadius: radii.lg,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  newChatText: { color: colors.accentInk, fontWeight: "800", fontSize: 15 },
});
