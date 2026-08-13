import { type AgentThread, listAgentThreads } from "@/api/client";
import { useSession } from "@/auth/session";
import { useSidebar } from "@/nav/SidebarContext";
import { colors, elevation, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PANEL_WIDTH = Math.min(340, Dimensions.get("window").width * 0.82);

/**
 * ChatGPT-style left drawer — watchlist, research chats, settings, ticker
 * search. Deliberately built with plain RN primitives (Modal + Pressable),
 * NO Reanimated + NO GestureDetector: earlier iterations that wrapped the
 * panel in a Pan gesture or laid a full-screen scrim over the panel body
 * both blocked child taps on iOS. Simple wins here.
 *
 * Layout:
 *   root: flexDirection "row"
 *     └── panel (fixed width, on the left)
 *     └── scrim (flex: 1, to the RIGHT of the panel — tap to close)
 * Scrim and panel never overlap, so panel taps always reach child Pressables.
 */
export function AppSidebar() {
  const { open, closeSidebar } = useSidebar();
  const router = useRouter();
  const { session, user } = useSession();
  const insets = useSafeAreaInsets();

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

  return (
    <Modal
      visible={open}
      // "slide" is horizontal by default on Modals wrapping a row layout;
      // on iOS this is a native slide-in from the left edge.
      animationType="slide"
      transparent
      onRequestClose={closeSidebar}
      // Absolute must for iOS pageSheet-style overlay behavior — keeps the
      // parent view visible behind the sidebar.
      presentationStyle="overFullScreen"
    >
      <View style={styles.root}>
        <View
          style={[
            styles.panel,
            elevation.lg,
            {
              width: PANEL_WIDTH,
              paddingTop: insets.top + 8,
              paddingBottom: insets.bottom + 12,
            },
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

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: 4, paddingBottom: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            <NavRow
              icon="home-outline"
              label="Home"
              hint="Your saved tickers"
              onPress={() => go("/(tabs)/home")}
            />
            <NavRow
              icon="map-outline"
              label="Map"
              hint="Places around you"
              onPress={() => go("/(tabs)/map")}
            />
            <NavRow
              icon="camera-outline"
              label="Camera"
              hint="Snap a brand"
              onPress={() => go("/(tabs)/camera")}
            />
            <NavRow
              icon="list-outline"
              label="Nearby list"
              hint="Places around you, sorted"
              onPress={() => go("/(tabs)/list")}
            />
            <NavRow
              icon="star-outline"
              label="Lists"
              hint="Named watchlists"
              onPress={() => go("/watchlists")}
            />
            <NavRow
              icon="folder-open-outline"
              label="Location folder"
              hint="Saved area briefs"
              onPress={() => go("/saved-locations")}
            />
            <NavRow
              icon="sparkles-outline"
              label="New research"
              hint="Start a brief"
              onPress={() => go("/(tabs)/research?intent=new")}
            />
            <NavRow
              icon="notifications-outline"
              label="Alerts"
              hint="Price + move triggers"
              onPress={() => go("/alerts")}
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
        </View>

        {/* Scrim ONLY covers the area to the right of the panel. Because it
            occupies a distinct flex slot (never overlapping the panel), it
            can NEVER intercept taps inside the panel — the class of bug that
            broke every previous iteration. */}
        <Pressable
          style={styles.scrim}
          onPress={closeSidebar}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        />
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
      style={({ pressed }) => [styles.navRow, pressed && { opacity: 0.65 }]}
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
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: 48,
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
