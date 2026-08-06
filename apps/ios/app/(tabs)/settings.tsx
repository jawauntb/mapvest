import { clearRobinhoodMcp, fetchSettings, saveRobinhoodMcp } from "@/api/client";
import { useSession } from "@/auth/session";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect, hapticSuccess } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

/**
 * /settings — account, sign-out, Robinhood MCP (via sidebar).
 * Sign-in / sign-out lives here (Phase 8 Slice B); other tabs work for guests.
 */
export default function SettingsScreen() {
  const { user, session, signOut } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  // Hooks below must stay unconditional — the tab tree keeps this screen
  // mounted (`unmountOnBlur: false`), so `session` can flip from null to set
  // (or back) without the component remounting. Branching before all hooks
  // run would violate the Rules of Hooks on that transition.
  const settingsQ = useQuery({
    queryKey: ["settings", session?.token],
    enabled: !!session?.token,
    queryFn: () => fetchSettings({ token: session!.token }),
  });

  const saveM = useMutation({
    mutationFn: () => saveRobinhoodMcp(token.trim(), { token: session!.token }),
    onSuccess: async () => {
      setToken("");
      Keyboard.dismiss();
      hapticSuccess();
      setStatus("Robinhood MCP key saved (encrypted in DB)");
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

  if (!session) {
    return <GuestHome />;
  }

  const rh = settingsQ.data?.robinhoodMcp;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.root}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <Text style={styles.h1}>Settings</Text>
        <Text style={styles.sub}>Account · integrations</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Signed in</Text>
          <Text style={styles.value}>{user?.email ?? "—"}</Text>
          <Text style={styles.muted}>{user?.id}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Ionicons name="link-outline" size={15} color={colors.accent} />
            <Text style={styles.label}>Robinhood MCP</Text>
          </View>
          <Text style={styles.muted}>
            Paste the bearer from your Robinhood agent / ChatGPT MCP connector. Once saved, ticker
            pages show Open in Robinhood so you can buy or place orders in Robinhood. Mapvest never
            submits broker orders. Key is encrypted in Postgres for your account.
          </Text>
          {settingsQ.isLoading ? (
            <ActivityIndicator color={colors.fg} style={{ marginTop: 12 }} />
          ) : rh?.configured ? (
            <View style={styles.configuredRow}>
              <Ionicons name="checkmark-circle" size={15} color={colors.accent} />
              <Text style={styles.value}>
                Configured · …{rh.last4} · fp {rh.fingerprint}
              </Text>
            </View>
          ) : (
            <Text style={styles.muted}>Not configured</Text>
          )}
          <TextInput
            style={styles.input}
            placeholder="Paste Robinhood MCP token"
            placeholderTextColor={colors.fgDim}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            textContentType="password"
            secureTextEntry={!showToken}
            value={token}
            onChangeText={setToken}
            onFocus={() => {
              // Keep field above the keyboard.
              setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
            }}
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
            blurOnSubmit
            accessibilityLabel="Robinhood MCP token"
          />
          <View style={styles.row}>
            <Pressable
              style={styles.btn}
              onPress={() => setShowToken((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={showToken ? "Hide token" : "Show token"}
            >
              <Ionicons
                name={showToken ? "eye-off-outline" : "eye-outline"}
                size={15}
                color={colors.fg}
              />
              <Text style={styles.btnText}>{showToken ? "Hide" : "Show"}</Text>
            </Pressable>
            <Pressable
              style={styles.btn}
              onPress={() => Keyboard.dismiss()}
              accessibilityRole="button"
              accessibilityLabel="Done"
            >
              <Text style={styles.btnText}>Done</Text>
            </Pressable>
          </View>
          <View style={styles.row}>
            <PrimaryButton
              label={saveM.isPending ? "Saving…" : "Save key"}
              busy={saveM.isPending}
              disabled={!token.trim()}
              onPress={() => {
                Keyboard.dismiss();
                saveM.mutate();
              }}
              style={{ flex: 1 }}
            />
            {rh?.configured ? (
              <Pressable
                style={styles.btn}
                disabled={clearM.isPending}
                onPress={() => clearM.mutate()}
                accessibilityRole="button"
                accessibilityLabel="Clear Robinhood MCP key"
              >
                <Ionicons name="trash-outline" size={15} color={colors.fg} />
                <Text style={styles.btnText}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {status ? <Text style={styles.status}>{status}</Text> : null}

        <Pressable
          style={styles.btn}
          onPress={async () => {
            hapticSelect();
            await signOut();
            router.replace("/auth");
          }}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Ionicons name="log-out-outline" size={15} color={colors.fg} />
          <Text style={styles.btnText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Shown on Home when there's no session — map/camera/list/research still work; only Save/settings need sign-in. */
function GuestHome() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.h1}>Settings</Text>
        <Text style={styles.sub}>Account · integrations</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Browsing as guest</Text>
          <Text style={styles.muted}>
            Map, Camera, and Research all work without an account. Sign in to save tickers to a
            watchlist, save memos, and connect your Robinhood MCP key.
          </Text>
          <PrimaryButton
            label="Sign in"
            onPress={() => router.push("/auth")}
            style={{ marginTop: 8, alignSelf: "stretch" }}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, gap: 16, paddingBottom: 120 },
  h1: { color: colors.fg, ...type.h1, fontSize: 28 },
  sub: { color: colors.fgMuted, marginTop: -8 },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { color: colors.accent, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  value: { color: colors.fg, fontSize: 16 },
  configuredRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  muted: { color: colors.fgMuted, fontSize: 13, lineHeight: 18 },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.fg,
    backgroundColor: colors.bgSunken,
    minHeight: 44,
  },
  row: { flexDirection: "row", gap: 10, marginTop: 8 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flex: 1,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    minHeight: 44,
  },
  btnText: { color: colors.fg, fontWeight: "600" },
  status: { color: colors.accent, fontSize: 13 },
});
