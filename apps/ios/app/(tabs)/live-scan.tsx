import { addToWatchlist, identifyPhoto } from "@/api/client";
import type { IdentifyResponse, LatLng } from "@/api/types";
import { useSession } from "@/auth/session";
import { sectorColor } from "@/util/sectors";
import { useQueryClient } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const FRAME_INTERVAL_MS = 1400;
const LIVE_CACHE_KEY = ["tab-state", "live"] as const;

type LiveCache = {
  latest: IdentifyResponse | null;
  err: string | null;
  frames: number;
  savedNote: string | null;
};

/** Live scan stops when you leave the tab or hit Stop — camera does not run forever. */
export default function LiveScanScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [perm, requestPerm] = useCameraPermissions();
  const cached = qc.getQueryData<LiveCache>(LIVE_CACHE_KEY);
  const [running, setRunning] = useState(false);
  const [latest, setLatest] = useState<IdentifyResponse | null>(cached?.latest ?? null);
  const [err, setErr] = useState<string | null>(cached?.err ?? null);
  const [frames, setFrames] = useState(cached?.frames ?? 0);
  const [savedNote, setSavedNote] = useState<string | null>(cached?.savedNote ?? null);

  function persistLive(next: Partial<LiveCache>) {
    const prev = qc.getQueryData<LiveCache>(LIVE_CACHE_KEY) ?? {
      latest: null,
      err: null,
      frames: 0,
      savedNote: null,
    };
    qc.setQueryData<LiveCache>(LIVE_CACHE_KEY, { ...prev, ...next });
  }
  const cameraRef = useRef<CameraView | null>(null);
  const inFlight = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationRef = useRef<LatLng | undefined>(undefined);
  const { session } = useSession();

  useEffect(() => {
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      locationRef.current = {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      };
    })();
  }, []);

  // Hard stop when navigating away — kills the green status-bar camera dot.
  useFocusEffect(
    useCallback(() => {
      return () => {
        setRunning(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };
    }, []),
  );

  useEffect(() => {
    if (!running) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = setInterval(() => void tick(), FRAME_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  async function tick() {
    if (inFlight.current || !cameraRef.current) return;
    inFlight.current = true;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.4,
        skipProcessing: true,
      });
      if (!photo?.uri) return;
      setFrames((n) => {
        const next = n + 1;
        persistLive({ frames: next });
        return next;
      });
      const resp = await identifyPhoto(
        { imageUri: photo.uri, location: locationRef.current },
        { token: session?.token },
      );
      setLatest(resp);
      setErr(null);
      persistLive({ latest: resp, err: null });
      // Auto-pause after a high-confidence public hit so user can Save / open.
      const hit = resp.investables[0];
      if (hit?.brand.isPublic && hit.brand.ticker?.symbol && hit.confidence === "high") {
        setRunning(false);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      persistLive({ err: msg });
    } finally {
      inFlight.current = false;
    }
  }

  if (!perm) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  if (!perm.granted) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.msg}>Camera access is required for live scan.</Text>
        <Pressable style={styles.btn} onPress={requestPerm}>
          <Text style={styles.btnText}>Grant access</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const top = latest?.investables[0];
  const ticker = top?.brand.ticker?.symbol ?? top?.comparables?.[0]?.ticker ?? undefined;
  const accent = sectorColor(top?.brand.sector);

  async function onSave() {
    if (!ticker || !top) return;
    if (!session?.token) {
      router.push("/auth");
      return;
    }
    setSavedNote(`Saving $${ticker}…`);
    try {
      await addToWatchlist(
        {
          ticker,
          name: top.brand.name,
          sector: top.brand.sector,
          source: "live",
        },
        { token: session.token },
      );
      setSavedNote(`★ Saved $${ticker}`);
    } catch (e) {
      setSavedNote(null);
      setErr(e instanceof Error ? e.message : "save failed");
    }
  }

  function openDetail() {
    if (ticker) router.push(`/detail/${ticker}`);
    else if (top?.brand.name) router.push(`/detail/${encodeURIComponent(top.brand.name)}`);
  }

  return (
    <View style={styles.root}>
      <CameraView
        ref={(r) => {
          cameraRef.current = r;
        }}
        style={StyleSheet.absoluteFillObject}
        facing="back"
      />
      <SafeAreaView style={styles.hud} edges={["top", "bottom"]}>
        <View style={styles.topBar}>
          <Text style={styles.status}>
            {running ? `Scanning · frame ${frames}` : "Idle · camera paused"}
          </Text>
        </View>

        {top ? (
          <View style={[styles.card, { borderLeftColor: accent, borderLeftWidth: 3 }]}>
            <Pressable onPress={openDetail}>
              <Text style={styles.cardTitle}>{top.brand.name}</Text>
              <Text style={styles.cardSub}>
                {ticker ? `$${ticker}` : "private"} · {top.confidence}
                {top.brand.sector ? ` · ${top.brand.sector}` : ""}
              </Text>
            </Pressable>
            <View style={styles.cardActions}>
              {ticker ? (
                <Pressable style={styles.miniBtn} onPress={() => void onSave()}>
                  <Text style={styles.miniBtnText}>☆ Save</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.miniBtn} onPress={openDetail}>
                <Text style={styles.miniBtnText}>Open · Research</Text>
              </Pressable>
            </View>
            {savedNote ? <Text style={styles.saved}>{savedNote}</Text> : null}
          </View>
        ) : null}

        {err ? (
          <View style={styles.errBar}>
            <Text style={styles.errText} numberOfLines={2}>
              {err}
            </Text>
          </View>
        ) : null}

        <View style={styles.controls}>
          <Pressable
            style={[styles.toggle, running && styles.toggleOn]}
            onPress={() => setRunning((r) => !r)}
          >
            <Text style={styles.toggleText}>{running ? "Stop scan" : "Start scan"}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  hud: { flex: 1, justifyContent: "space-between" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
  },
  topBar: { alignItems: "flex-end", padding: 12 },
  status: {
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 12,
  },
  card: {
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.78)",
    gap: 8,
  },
  cardTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  cardSub: { color: "#ccc", fontSize: 13, marginTop: 2 },
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  miniBtn: {
    backgroundColor: "#1a1a1a",
    borderColor: "#333",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  miniBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  saved: { color: "#3ee68a", fontSize: 12 },
  errBar: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "rgba(120,0,0,0.6)",
  },
  errText: { color: "#fff", fontSize: 12 },
  controls: { alignItems: "center", paddingBottom: 24 },
  toggle: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: "#fff",
  },
  toggleOn: { backgroundColor: "#ff5a5a" },
  toggleText: { color: "#000", fontWeight: "700" },
  msg: { color: "#fff", padding: 24, textAlign: "center" },
  btn: { backgroundColor: "#fff", padding: 12, borderRadius: 8 },
  btnText: { color: "#000", fontWeight: "700" },
});
