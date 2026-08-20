import { clearRobinhoodMcp, fetchSettings, saveRobinhoodMcp } from "@/api/client";
import { useSession } from "@/auth/session";
import { usePaywall } from "@/billing/Paywall";
import { useEntitlements } from "@/billing/useEntitlements";
import { PrimaryButton } from "@/components/PrimaryButton";
import {
  disableVisitMonitoring,
  enableVisitMonitoring,
  isVisitMonitoringEnabled,
} from "@/location/visits";
import {
  PUSH_EVENT_LABELS,
  PUSH_EVENT_ORDER,
  type PushEventKey,
  type PushPrefs,
  getPushPrefs,
  setPushPref,
} from "@/notif/prefs";
import { ensurePermissions, getStoredTokenId, registerForPush } from "@/notif/registerForPush";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect, hapticSuccess } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

/**
 * /settings — account, sign-out, Robinhood MCP, opt-in push notifications.
 * Sign-in / sign-out lives here (Phase 8 Slice B); other tabs work for guests.
 *
 * Notifications section is entirely opt-in: master switch requests OS
 * permission on first flip; individual per-event toggles POST to
 * /v1/push/prefs on every change (fire-and-forget).
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
        <Text style={styles.sub}>Account · integrations</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Signed in</Text>
          <Text style={styles.value}>{user?.email ?? "—"}</Text>
          <Text style={styles.muted}>{user?.id}</Text>
        </View>

        <PlanCard />

        <NotificationsSection sessionToken={session.token} />
        <VisitMonitoringSection sessionToken={session.token} />

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

// ---------- Notifications sub-section ----------

/**
 * One-per-event toggle list. All prefs default to `false`; the user MUST
 * flip individual switches for each notification kind they want. A master
 * "Enable notifications" switch at top requests the OS permission and, once
 * granted, keeps the individual toggles visible + interactive. When permission
 * is denied we still register the token (spec) but disable interaction on the
 * per-event switches so a user isn't tricked into a no-op change.
 */
function NotificationsSection({ sessionToken }: { sessionToken: string }) {
  const [permissionStatus, setPermissionStatus] = useState<
    "unknown" | "granted" | "denied" | "undetermined"
  >("unknown");
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs>({});
  const [busy, setBusy] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<Partial<PushPrefs>>({});

  // Initial load — permission + prefs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await Notifications.getPermissionsAsync();
        if (cancelled) return;
        setPermissionStatus(
          perm.status === "granted"
            ? "granted"
            : perm.status === "denied"
              ? "denied"
              : "undetermined",
        );
        const stored = await getStoredTokenId();
        const remote = await getPushPrefs({ token: sessionToken });
        if (cancelled) return;
        setTokenId(remote.tokenId ?? stored);
        setPrefs(remote.prefs);
      } catch {
        /* silent — UI shows disabled state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  const commit = useCallback(() => {
    if (!tokenId) return;
    const patch = pendingPatch.current;
    pendingPatch.current = {};
    if (Object.keys(patch).length === 0) return;
    void setPushPref(tokenId, patch, { token: sessionToken });
  }, [tokenId, sessionToken]);

  const scheduleCommit = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(commit, 400);
  }, [commit]);

  const setEvent = (key: PushEventKey, val: boolean) => {
    setPrefs((prev) => ({ ...prev, [key]: val }));
    pendingPatch.current = { ...pendingPatch.current, [key]: val };
    scheduleCommit();
    hapticSelect();
  };

  const onToggleMaster = async (next: boolean) => {
    if (!next) {
      // "Master off" turns every event pref to false in one write. The OS
      // permission itself can only be revoked from iOS Settings — we honor
      // the user's intent by muting everything.
      const off: PushPrefs = {};
      for (const k of PUSH_EVENT_ORDER) off[k] = false;
      setPrefs((prev) => ({ ...prev, ...off }));
      pendingPatch.current = { ...pendingPatch.current, ...off };
      scheduleCommit();
      return;
    }
    setBusy(true);
    try {
      const granted = await ensurePermissions();
      setPermissionStatus(granted ? "granted" : "denied");
      if (granted) {
        // Ensure the server has a token for us. registerForPush is idempotent.
        const res = await registerForPush({ token: sessionToken });
        if (res?.tokenId) setTokenId(res.tokenId);
      }
    } finally {
      setBusy(false);
    }
  };

  const masterOn = permissionStatus === "granted";
  const anyEventOn = PUSH_EVENT_ORDER.some((k) => prefs[k] === true);

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Ionicons name="notifications-outline" size={15} color={colors.accent} />
        <Text style={styles.label}>Notifications</Text>
      </View>
      <Text style={styles.muted}>
        Opt-in push notifications. Each event below is off by default. Turn on the master switch to
        grant iOS permission, then pick which events you want to hear about.
      </Text>

      <View style={styles.notifRow}>
        <Text style={styles.notifLabel}>Enable notifications</Text>
        <Switch
          value={masterOn}
          disabled={busy}
          onValueChange={onToggleMaster}
          accessibilityLabel="Enable notifications"
        />
      </View>

      {permissionStatus === "denied" ? (
        <Text style={styles.muted}>
          iOS permission is currently denied. Open Settings → Notifications → Mapvest to allow push,
          then return here to pick which events you want.
        </Text>
      ) : null}

      {PUSH_EVENT_ORDER.map((key) => (
        <View style={styles.notifRow} key={key}>
          <Text style={styles.notifLabel}>{PUSH_EVENT_LABELS[key]}</Text>
          <Switch
            value={prefs[key] === true}
            disabled={!masterOn || !tokenId}
            onValueChange={(v) => setEvent(key, v)}
            accessibilityLabel={PUSH_EVENT_LABELS[key]}
          />
        </View>
      ))}

      {masterOn && !anyEventOn ? (
        <Text style={styles.muted}>
          Nothing is enabled yet — flip any switch above to start receiving that event type.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * B5 Always-permission visit monitoring. Offered only after the user has
 * opted into B4 uncaught-nearby arrivals — never at onboarding. The toggle
 * asks Once and stays silent on denial (see visits.ts).
 */
function VisitMonitoringSection({ sessionToken }: { sessionToken: string }) {
  const [feltB4, setFeltB4] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remote = await getPushPrefs({ token: sessionToken });
        const monitoring = await isVisitMonitoringEnabled();
        if (cancelled) return;
        setFeltB4(remote.prefs.uncaught_nearby === true);
        setEnabled(monitoring);
      } catch {
        /* keep the gated-off copy */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  const onToggle = async (next: boolean) => {
    setBusy(true);
    try {
      if (next) {
        const ok = await enableVisitMonitoring();
        setEnabled(ok);
      } else {
        await disableVisitMonitoring();
        setEnabled(false);
      }
      hapticSelect();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Ionicons name="navigate-outline" size={15} color={colors.accent} />
        <Text style={styles.label}>Arrival monitoring</Text>
      </View>
      {feltB4 ? (
        <>
          <Text style={styles.muted}>
            Let Mapvest notice when you arrive somewhere with the app closed, so nearby brands you
            have not caught can still surface. Uses the same When-In-Use grant first, then asks
            Always once. Never tracks a path.
          </Text>
          <View style={styles.notifRow}>
            <Text style={styles.notifLabel}>Monitor arrivals in the background</Text>
            <Switch
              value={enabled}
              disabled={busy}
              onValueChange={onToggle}
              accessibilityLabel="Monitor arrivals in the background"
            />
          </View>
        </>
      ) : (
        <Text style={styles.muted}>
          Turn on uncaught-nearby notifications first. After you have felt those arrival pings, you
          can let Mapvest notice visits with the app closed.
        </Text>
      )}
    </View>
  );
}

/** Shown on Home when there's no session — map/camera/list/research still work; only Save/settings need sign-in. */
function GuestHome() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
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

        <PlanCard />
      </ScrollView>
    </View>
  );
}

function planCopy(plan: string, freeForever: boolean, subscribed: boolean): string {
  if (freeForever) return "Free forever";
  if (subscribed || plan === "subscribed") return "Mapvest Pro";
  if (plan === "free_trial") return "Free trial";
  return "Free tier";
}

function PlanCard() {
  const { presentPaywall } = usePaywall();
  const q = useEntitlements();
  const data = q.data;

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Ionicons name="sparkles-outline" size={15} color={colors.accent} />
        <Text style={styles.label}>Plan</Text>
      </View>
      {q.isLoading ? (
        <ActivityIndicator color={colors.fg} style={{ marginTop: 8 }} />
      ) : data ? (
        <>
          <Text style={styles.value}>{planCopy(data.plan, data.freeForever, data.subscribed)}</Text>
          {data.freeForever || data.subscribed ? (
            <Text style={styles.muted}>Unlimited identify, research, and memos.</Text>
          ) : (
            <Text style={styles.muted}>
              {data.remaining} of {data.limit} free generations left. Identify, research, and memos
              count. Map and nearby stay free. Pro is $19.99/month. Research, not advice.
            </Text>
          )}
          {!data.freeForever && !data.subscribed ? (
            <PrimaryButton
              label="Subscribe $19.99/mo"
              onPress={() => presentPaywall()}
              style={{ marginTop: 8, alignSelf: "stretch" }}
            />
          ) : data.subscribed && !data.freeForever ? (
            <Pressable
              style={styles.btn}
              onPress={() => presentPaywall()}
              accessibilityRole="button"
              accessibilityLabel="Manage subscription"
            >
              <Text style={styles.btnText}>Manage subscription</Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <Text style={styles.muted}>Could not load plan status.</Text>
      )}
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
  notifRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    gap: 12,
  },
  notifLabel: {
    color: colors.fg,
    fontSize: 15,
    flex: 1,
    paddingRight: 8,
  },
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
