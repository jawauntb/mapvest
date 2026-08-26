import { addToWatchlist, identifyPhoto } from "@/api/client";
import type { IdentifyResponse, LatLng } from "@/api/types";
import { useSession } from "@/auth/session";
import { presentPaywallIfQuota, usePaywall } from "@/billing/Paywall";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSuccess, hapticTap } from "@/util/haptics";
import { sectorColor } from "@/util/sectors";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { Stack, useRouter } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Landing screen for "Share to Mapvest" — the receiving half of the same
 * "Open in…" pattern iOS shows for Messages/Claude/ChatGPT/Google Photos.
 * `ShareIntentListener` (mounted in `_layout.tsx`) routes here as soon as
 * the OS hands the app a shared image; this screen runs it through the same
 * `/v1/identify` pipeline the Camera tab uses, then lets the user save or
 * open the full detail sheet.
 */
export default function ShareIntentScreen() {
  const { shareIntent, resetShareIntent, error: shareError } = useShareIntentContext();
  const { session } = useSession();
  const { presentPaywall } = usePaywall();
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IdentifyResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const ranFor = useRef<string | null>(null);

  // Require a usable local path up front — the parser can hand back
  // `path: null` (e.g. a share the extension couldn't copy), and a null path
  // would both render a broken preview and dead-lock the ranFor guard below
  // (null === null on first render → identify never runs, screen just hangs).
  const imageFile =
    shareIntent?.files?.find((f) => f.mimeType?.startsWith("image/") && !!f.path) ?? null;

  useEffect(() => {
    if (!imageFile?.path) return;
    // Guard against re-running on every render for the same shared file.
    if (ranFor.current === imageFile.path) return;
    ranFor.current = imageFile.path;
    void runIdentify(imageFile.path);
  }, [imageFile]);

  async function currentLocation(): Promise<LatLng | undefined> {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return undefined;
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return { lat: loc.coords.latitude, lng: loc.coords.longitude };
    } catch {
      return undefined;
    }
  }

  async function runIdentify(imageUri: string) {
    setBusy(true);
    setErr(null);
    setResult(null);
    setSavedNote(null);
    try {
      const location = await currentLocation();
      const resp = await identifyPhoto({ imageUri, location }, { token: session?.token });
      setResult(resp);
    } catch (e) {
      if (presentPaywallIfQuota(e, presentPaywall)) {
        setErr("Free generations used. Subscribe to keep identifying.");
        return;
      }
      setErr(e instanceof Error ? e.message : "Could not identify that image.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    resetShareIntent();
    router.canGoBack() ? router.back() : router.replace("/(tabs)/home");
  }

  // Defensive chaining: identifyPhoto casts the response without validating,
  // so a 200 with an unexpected shape must not throw during render.
  const top = result?.investables?.[0];
  const ticker = top?.brand.ticker?.symbol ?? top?.comparables?.[0]?.ticker ?? undefined;
  const accent = sectorColor(top?.brand.sector);

  function openDetail() {
    const id = ticker ?? top?.brand.name;
    if (!id) return;
    resetShareIntent();
    // Dismiss the modal first, then push detail as a normal card. Replacing a
    // `presentation: "modal"` screen in place with a `card` screen makes
    // react-native-screens swap stackPresentation on a presenting controller —
    // the same UIKit hazard the detail route's comment in _layout.tsx warns
    // about.
    if (router.canGoBack()) router.back();
    router.push(`/detail/${encodeURIComponent(id)}`);
  }

  async function onSave() {
    if (!ticker || !top) return;
    if (!session?.token) {
      router.push("/auth");
      return;
    }
    setSavedNote(`Saving $${ticker}…`);
    try {
      await addToWatchlist(
        { ticker, name: top.brand.name, sector: top.brand.sector, source: "manual" },
        { token: session.token },
      );
      hapticSuccess();
      setSavedNote(`Saved $${ticker}`);
    } catch (e) {
      setSavedNote(null);
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      {/* Static options (presentation, header chrome, title) live on the
          route declaration in _layout.tsx. Re-declaring `presentation` here
          made the native stack reconfigure an already-presenting modal —
          only the dynamic close button belongs in this per-render call. */}
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => {
                hapticTap();
                close();
              }}
              hitSlop={12}
              style={{
                minWidth: 44,
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color={colors.fg} />
            </Pressable>
          ),
        }}
      />

      {!imageFile ? (
        <EmptyState
          icon="images-outline"
          title={shareError ? "Share failed" : "No image in that share"}
          subtitle={
            shareError
              ? shareError
              : shareIntent?.text || shareIntent?.webUrl
                ? "Mapvest can only identify shared photos right now — share an image from Photos, Messages, or a browser to get a ticker."
                : "Waiting for a shared photo…"
          }
        />
      ) : (
        <View style={{ flex: 1 }}>
          <Image source={{ uri: imageFile.path }} style={styles.preview} resizeMode="cover" />

          {busy ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.fg} size="large" />
              <Text style={styles.msg}>Identifying…</Text>
            </View>
          ) : result ? (
            <View style={[styles.card, { borderLeftColor: accent, borderLeftWidth: 3 }]}>
              {top ? (
                <Pressable onPress={openDetail} accessibilityRole="button">
                  <Text style={styles.title}>{top.brand.name}</Text>
                  <Text style={styles.subtitle}>
                    {ticker ? `$${ticker}` : "private"} · {top.confidence}
                    {top.brand.sector ? ` · ${top.brand.sector}` : ""}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.title}>No investable brand detected</Text>
              )}
              <View style={styles.actions}>
                {ticker ? (
                  <Pressable style={styles.miniBtn} onPress={() => void onSave()}>
                    <Ionicons name="star-outline" size={13} color={colors.accent} />
                    <Text style={styles.miniBtnText}>Save</Text>
                  </Pressable>
                ) : null}
                {top ? (
                  <Pressable style={styles.miniBtn} onPress={openDetail}>
                    <Ionicons name="document-text-outline" size={13} color={colors.accent} />
                    <Text style={styles.miniBtnText}>View details</Text>
                  </Pressable>
                ) : null}
              </View>
              {savedNote ? <Text style={styles.saved}>{savedNote}</Text> : null}
              <PrimaryButton label="Done" onPress={close} style={{ marginTop: 12 }} />
            </View>
          ) : err ? (
            <View style={styles.card}>
              <Text style={styles.err}>{err}</Text>
              <PrimaryButton
                label="Retry"
                onPress={() => void runIdentify(imageFile.path)}
                style={{ marginTop: 12 }}
              />
            </View>
          ) : null}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  preview: { width: "100%", height: "45%", backgroundColor: colors.bgSunken },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  msg: { color: colors.fgMuted, fontSize: 13 },
  card: {
    margin: 16,
    padding: 16,
    borderRadius: radii.lg,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  title: { color: colors.fg, ...type.h3, fontSize: 18 },
  subtitle: { color: colors.fgMuted, fontSize: 13, marginTop: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  miniBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.bgSunken,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 32,
  },
  miniBtnText: { color: colors.fg, fontSize: 13, fontWeight: "600" },
  saved: { color: colors.accent, fontSize: 12, marginTop: 2 },
  err: { color: colors.danger, fontSize: 14 },
});
