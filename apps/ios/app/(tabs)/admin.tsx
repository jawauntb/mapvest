import { useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { adminMetrics } from "@/api/client";
import { useSession } from "@/auth/session";
import { ScreenFade } from "@/components/ScreenFade";
import { colors, elevation, radii, type } from "@/theme/tokens";

export default function AdminScreen() {
  const { session, user, isAdmin, signOut } = useSession();
  const q = useQuery({
    queryKey: ["admin-metrics"],
    enabled: !!session?.token && isAdmin,
    queryFn: () => adminMetrics({ token: session?.token }),
    staleTime: 15_000,
  });

  if (!isAdmin) return <Redirect href="/(tabs)/map" />;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScreenFade>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text style={styles.h1}>Admin</Text>
        <Text style={styles.sub}>
          Signed in as {user?.email} · scopes: {user?.scopes.join(", ")}
        </Text>

        {q.isLoading ? (
          <ActivityIndicator color={colors.fg} />
        ) : q.isError ? (
          <Text style={styles.err}>{(q.error as Error).message}</Text>
        ) : q.data ? (
          <View style={styles.grid}>
            <Stat label="Requests / 24h" value={q.data.requests24h} icon="pulse-outline" />
            <Stat label="Identify / 24h" value={q.data.identify24h} icon="camera-outline" />
            <Stat label="Active users" value={q.data.activeUsers} icon="people-outline" />
          </View>
        ) : null}

        <Pressable
          style={styles.signOut}
          onPress={signOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Ionicons name="log-out-outline" size={15} color={colors.fg} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
      </ScreenFade>
    </SafeAreaView>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={[styles.stat, elevation.sm]}>
      <Ionicons name={icon} size={16} color={colors.accent} />
      <Text style={styles.statValue}>{value.toLocaleString()}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  h1: { color: colors.fg, ...type.h1, fontSize: 28 },
  sub: { color: colors.fgMuted, fontSize: 13 },
  err: { color: colors.danger },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  stat: {
    minWidth: 140,
    flexGrow: 1,
    padding: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    gap: 4,
  },
  statValue: { color: colors.fg, fontSize: 22, fontWeight: "700" },
  statLabel: { color: colors.fgMuted, fontSize: 12 },
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 16,
    padding: 12,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    minHeight: 44,
  },
  signOutText: { color: colors.fg },
});
