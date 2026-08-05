import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { identifyPhoto } from "@/api/client";
import type { IdentifyResponse, LatLng } from "@/api/types";
import { useSession } from "@/auth/session";

// Live-scan captures frames on a ~1 Hz cadence and pipes each into
// /v1/identify. We throttle both by wall-clock interval AND by an in-flight
// guard so a slow response cannot backlog the queue.

const FRAME_INTERVAL_MS = 1000;

export default function LiveScanScreen() {
  const [perm, requestPerm] = useCameraPermissions();
  const [running, setRunning] = useState(false);
  const [latest, setLatest] = useState<IdentifyResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [frames, setFrames] = useState(0);
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

  useEffect(() => {
    if (!running) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = setInterval(tick, FRAME_INTERVAL_MS);
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
      setFrames((n) => n + 1);
      const resp = await identifyPhoto(
        { imageUri: photo.uri, location: locationRef.current },
        { token: session?.token },
      );
      setLatest(resp);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
            {running ? `Scanning · frame ${frames}` : "Idle"}
          </Text>
        </View>

        {top ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{top.brand.name}</Text>
            <Text style={styles.cardSub}>
              {top.brand.isPublic
                ? `${top.brand.ticker?.symbol ?? ""} · ${top.confidence}`
                : `private · ${top.comparables.length} comps`}
            </Text>
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
            <Text style={styles.toggleText}>
              {running ? "Stop scan" : "Start scan"}
            </Text>
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
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  cardTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  cardSub: { color: "#ccc", fontSize: 13, marginTop: 2 },
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
