import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  clearRobinhoodMcp,
  fetchSettings,
  saveRobinhoodMcp,
} from "@/api/client";
import { useSession } from "@/auth/session";

/**
 * /home — account, sign-out, Robinhood MCP key (server-side masked store).
 */
export default function HomeSettingsScreen() {
  const { user, session, signOut } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const settingsQ = useQuery({
    queryKey: ["settings", session?.token],
    enabled: !!session?.token,
    queryFn: () => fetchSettings({ token: session!.token }),
  });

  const saveM = useMutation({
    mutationFn: () => saveRobinhoodMcp(token.trim(), { token: session!.token }),
    onSuccess: async () => {
      setToken("");
      setStatus("Robinhood MCP key saved (masked on server)");
      await qc.invalidateQueries({ queryKey: ["settings", session?.token] });
    },
    onError: (e) => setStatus((e as Error).message || "Save failed"),
  });

  const clearM = useMutation({
    mutationFn: () => clearRobinhoodMcp({ token: session!.token }),
    onSuccess: async () => {
      setStatus("Robinhood MCP key cleared");
      await qc.invalidateQueries({ queryKey: ["settings", session?.token] });
    },
    onError: (e) => setStatus((e as Error).message || "Clear failed"),
  });

  const rh = settingsQ.data?.robinhoodMcp;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Home</Text>
      <Text style={styles.sub}>Account · settings · integrations</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Signed in</Text>
        <Text style={styles.value}>{user?.email ?? "—"}</Text>
        <Text style={styles.muted}>{user?.id}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Robinhood MCP</Text>
        <Text style={styles.muted}>
          Paste the bearer from your Robinhood agent / ChatGPT MCP connector. Once saved,
          ticker pages show Open in Robinhood so you can buy or place orders in Robinhood.
          Mapvest never submits broker orders. Key is stored server-side (fingerprint only).
        </Text>
        {settingsQ.isLoading ? (
          <ActivityIndicator color="#fff" style={{ marginTop: 12 }} />
        ) : rh?.configured ? (
          <Text style={styles.value}>
            Configured · …{rh.last4} · fp {rh.fingerprint}
          </Text>
        ) : (
          <Text style={styles.muted}>Not configured</Text>
        )}
        <TextInput
          style={styles.input}
          placeholder="Paste Robinhood MCP token"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={token}
          onChangeText={setToken}
        />
        <View style={styles.row}>
          <Pressable
            style={[styles.btn, styles.btnPrimary]}
            disabled={!token.trim() || saveM.isPending}
            onPress={() => saveM.mutate()}
          >
            <Text style={styles.btnTextDark}>
              {saveM.isPending ? "Saving…" : "Save key"}
            </Text>
          </Pressable>
          {rh?.configured ? (
            <Pressable
              style={styles.btn}
              disabled={clearM.isPending}
              onPress={() => clearM.mutate()}
            >
              <Text style={styles.btnText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}

      <Pressable
        style={styles.btn}
        onPress={async () => {
          await signOut();
          router.replace("/auth");
        }}
      >
        <Text style={styles.btnText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  content: { padding: 20, gap: 16, paddingBottom: 48 },
  h1: { color: "#fff", fontSize: 28, fontWeight: "700" },
  sub: { color: "#888", marginTop: -8 },
  card: {
    backgroundColor: "#141414",
    borderRadius: 14,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: "#222",
  },
  label: { color: "#9f9", fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  value: { color: "#fff", fontSize: 16 },
  muted: { color: "#777", fontSize: 13, lineHeight: 18 },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#fff",
    backgroundColor: "#0a0a0a",
  },
  row: { flexDirection: "row", gap: 10, marginTop: 8 },
  btn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#444",
    paddingVertical: 12,
    alignItems: "center",
  },
  btnPrimary: { backgroundColor: "#c8f5c8", borderColor: "#c8f5c8" },
  btnText: { color: "#fff", fontWeight: "600" },
  btnTextDark: { color: "#000", fontWeight: "700" },
  status: { color: "#9f9", fontSize: 13 },
});
