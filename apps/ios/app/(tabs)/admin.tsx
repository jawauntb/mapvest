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
import { adminMetrics } from "@/api/client";
import { useSession } from "@/auth/session";

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
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text style={styles.h1}>Admin</Text>
        <Text style={styles.sub}>
          Signed in as {user?.email} · scopes: {user?.scopes.join(", ")}
        </Text>

        {q.isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : q.isError ? (
          <Text style={styles.err}>{(q.error as Error).message}</Text>
        ) : q.data ? (
          <View style={styles.grid}>
            <Stat label="Requests / 24h" value={q.data.requests24h} />
            <Stat label="Identify / 24h" value={q.data.identify24h} />
            <Stat label="Active users" value={q.data.activeUsers} />
          </View>
        ) : null}

        <Pressable style={styles.signOut} onPress={signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value.toLocaleString()}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  h1: { color: "#fff", fontSize: 28, fontWeight: "700" },
  sub: { color: "#888", fontSize: 13 },
  err: { color: "#ff5a5a" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  stat: {
    minWidth: 140,
    flexGrow: 1,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#111",
    borderColor: "#222",
    borderWidth: 1,
  },
  statValue: { color: "#fff", fontSize: 22, fontWeight: "700" },
  statLabel: { color: "#888", fontSize: 12, marginTop: 4 },
  signOut: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    borderColor: "#333",
    borderWidth: 1,
    alignItems: "center",
  },
  signOutText: { color: "#fff" },
});
