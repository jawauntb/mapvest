import { listAgentThreads, type AgentThread } from "@/api/client";
import { useSession } from "@/auth/session";
import { useSidebar } from "@/nav/SidebarContext";
import { colors } from "@/theme/tokens";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * ChatGPT-style left drawer — watchlist, research chats, settings/home,
 * ticker search entry. Keeps the bottom tab bar slim.
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
    closeSidebar();
    router.push(path as never);
  }

  return (
    <Modal visible={open} animationType="fade" transparent onRequestClose={closeSidebar}>
      <View style={styles.root}>
        <View style={[styles.panel, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.brandRow}>
            <Text style={styles.brand}>Mapvest</Text>
            <Pressable onPress={closeSidebar} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 4, paddingBottom: 16 }}>
            <NavRow label="Home" hint="Watchlist · map · camera" onPress={() => go("/(tabs)/home")} />
            <NavRow label="Watchlist" hint="Saved tickers" onPress={() => go("/(tabs)/saved")} />
            <NavRow
              label="New research"
              hint="Start a brief"
              onPress={() => go("/(tabs)/research?intent=new")}
            />
            <NavRow label="Find ticker" hint="Search by symbol" onPress={() => go("/(tabs)/home?focus=search")} />
            <NavRow
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
                    closeSidebar();
                    router.push(`/(tabs)/research?intent=thread&id=${encodeURIComponent(t.id)}` as never);
                  }}
                >
                  <Text style={styles.threadTitle} numberOfLines={1}>
                    {t.title || "Research"}
                  </Text>
                  {t.preview ? (
                    <Text style={styles.threadPreview} numberOfLines={1}>
                      {t.preview}
                    </Text>
                  ) : null}
                </Pressable>
              ))
            )}
          </ScrollView>

          <Pressable
            style={styles.newChatBtn}
            onPress={() => go("/(tabs)/research?intent=new")}
          >
            <Text style={styles.newChatText}>＋ New chat</Text>
          </Pressable>
        </View>
        <Pressable style={styles.scrim} onPress={closeSidebar} accessibilityLabel="Close menu" />
      </View>
    </Modal>
  );
}

function NavRow({
  label,
  hint,
  onPress,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.navRow} onPress={onPress}>
      <Text style={styles.navLabel}>{label}</Text>
      {hint ? <Text style={styles.navHint}>{hint}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row" },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  panel: {
    width: "78%",
    maxWidth: 340,
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
  brand: { color: "#fff", fontSize: 22, fontWeight: "800" },
  close: { color: "#888", fontSize: 18, padding: 4 },
  section: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
    marginTop: 18,
    marginBottom: 6,
  },
  muted: { color: "#777", fontSize: 13, lineHeight: 18 },
  navRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#222",
    gap: 2,
  },
  navLabel: { color: "#fff", fontSize: 16, fontWeight: "600" },
  navHint: { color: "#777", fontSize: 12 },
  threadRow: { paddingVertical: 10, gap: 2 },
  threadTitle: { color: "#ddd", fontSize: 14, fontWeight: "500" },
  threadPreview: { color: "#666", fontSize: 12 },
  newChatBtn: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  newChatText: { color: colors.accentInk, fontWeight: "800", fontSize: 15 },
});
