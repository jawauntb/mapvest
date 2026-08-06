import { addToWatchlist, identifyPhoto } from "@/api/client";
import type { IdentifyResponse, LatLng } from "@/api/types";
import { useSession } from "@/auth/session";
import { enqueuePhoto } from "@/queue/photoQueue";
import { useNetworkSync } from "@/queue/useNetworkSync";
import { sectorColor } from "@/util/sectors";
import { useIsFocused } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type CameraCache = {
  frozenUri: string | null;
  result: IdentifyResponse | null;
  err: string | null;
  queuedNote: string | null;
  savedNote: string | null;
};

const CAMERA_CACHE_KEY = ["tab-state", "camera"] as const;

/** Capture freezes the frame with the ticker — camera does not stay live. */
export default function CameraScreen() {
  const focused = useIsFocused();
  const [perm, requestPerm] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const readyRef = useRef(false);
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const { online, pending } = useNetworkSync({ token: session?.token });
  const cached = qc.getQueryData<CameraCache>(CAMERA_CACHE_KEY);
  const [busy, setBusy] = useState(false);
  const [frozenUri, setFrozenUri] = useState<string | null>(cached?.frozenUri ?? null);
  const [result, setResult] = useState<IdentifyResponse | null>(cached?.result ?? null);
  const [err, setErr] = useState<string | null>(cached?.err ?? null);
  const [queuedNote, setQueuedNote] = useState<string | null>(cached?.queuedNote ?? null);
  const [savedNote, setSavedNote] = useState<string | null>(cached?.savedNote ?? null);

  // Drop stale ready flag when CameraView unmounts (tab blur / frozen frame).
  useEffect(() => {
    if (!focused || frozenUri) {
      readyRef.current = false;
      cameraRef.current = null;
    }
  }, [focused, frozenUri]);

  function persistCamera(next: Partial<CameraCache>) {
    const prev = qc.getQueryData<CameraCache>(CAMERA_CACHE_KEY) ?? {
      frozenUri: null,
      result: null,
      err: null,
      queuedNote: null,
      savedNote: null,
    };
    qc.setQueryData<CameraCache>(CAMERA_CACHE_KEY, { ...prev, ...next });
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
        <Text style={styles.msg}>Mapvest needs camera access.</Text>
        <Pressable style={styles.btn} onPress={requestPerm}>
          <Text style={styles.btnText}>Grant access</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  async function currentLocation(): Promise<LatLng | undefined> {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return undefined;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return { lat: loc.coords.latitude, lng: loc.coords.longitude };
    } catch {
      return undefined;
    }
  }

  async function capture() {
    if (busy) return;
    if (!focused) {
      setErr("Camera tab not active — try again.");
      return;
    }
    if (!cameraRef.current || !readyRef.current) {
      setErr("Camera still starting — wait a sec and tap again.");
      return;
    }
    setBusy(true);
    setErr(null);
    setResult(null);
    setQueuedNote(null);
    setSavedNote(null);
    try {
      // Live scan can hold the camera if both tabs stay mounted — we unmount
      // CameraView when unfocused. Prefer processed JPEG for a reliable still.
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.75,
        skipProcessing: false,
        exif: false,
        shutterSound: false,
      });
      if (!photo?.uri) throw new Error("No photo captured.");
      setFrozenUri(photo.uri);
      persistCamera({ frozenUri: photo.uri, result: null, err: null, queuedNote: null });
      const location = await currentLocation();

      if (!online) {
        await enqueuePhoto({ imageUri: photo.uri, location });
        const note = "Offline — queued. Will upload when back online.";
        setQueuedNote(note);
        persistCamera({ queuedNote: note });
        return;
      }

      try {
        const resp = await identifyPhoto(
          { imageUri: photo.uri, location },
          { token: session?.token },
        );
        setResult(resp);
        persistCamera({ result: resp, err: null });
      } catch (e) {
        await enqueuePhoto({ imageUri: photo.uri, location });
        const msg = e instanceof Error ? e.message : String(e);
        setQueuedNote("Upload failed — queued for retry.");
        setErr(msg);
        persistCamera({ queuedNote: "Upload failed — queued for retry.", err: msg });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || "Capture failed");
      persistCamera({ err: msg });
    } finally {
      setBusy(false);
    }
  }

  function retake() {
    setFrozenUri(null);
    setResult(null);
    setErr(null);
    setQueuedNote(null);
    setSavedNote(null);
    readyRef.current = false;
    persistCamera({
      frozenUri: null,
      result: null,
      err: null,
      queuedNote: null,
      savedNote: null,
    });
  }

  const top = result?.investables[0];
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
          source: "camera",
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

  // Only mount the camera while this tab is focused — otherwise Live/Camera
  // fight for the same hardware session and shutter silently fails.
  const showLivePreview = focused && !frozenUri;

  return (
    <View style={styles.root}>
      {frozenUri ? (
        <Image source={{ uri: frozenUri }} style={StyleSheet.absoluteFillObject} />
      ) : showLivePreview ? (
        <CameraView
          ref={(r) => {
            cameraRef.current = r;
          }}
          style={StyleSheet.absoluteFillObject}
          facing="back"
          mode="picture"
          onCameraReady={() => {
            readyRef.current = true;
          }}
          onMountError={(e) => {
            readyRef.current = false;
            setErr(e.message || "Camera failed to start");
          }}
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.center]}>
          <Text style={styles.msg}>Opening camera…</Text>
        </View>
      )}
      <SafeAreaView style={styles.hud} edges={["top", "bottom"]} pointerEvents="box-none">
        <View style={styles.statusRow} pointerEvents="none">
          <Text style={styles.status}>
            {frozenUri ? "Frozen" : online ? "Online" : "Offline"}{" "}
            {pending.length ? `· ${pending.length} queued` : ""}
          </Text>
        </View>

        <View style={styles.center} pointerEvents="none">
          {busy ? <ActivityIndicator color="#fff" size="large" /> : null}
        </View>

        {result || err || queuedNote ? (
          <View style={[styles.resultCard, { borderLeftColor: accent, borderLeftWidth: 3 }]}>
            {top ? (
              <Pressable onPress={openDetail}>
                <Text style={styles.resultTitle}>{top.brand.name}</Text>
                <Text style={styles.resultSubtitle}>
                  {ticker ? `$${ticker}` : "private"} · {top.confidence}
                  {top.brand.sector ? ` · ${top.brand.sector}` : ""}
                </Text>
              </Pressable>
            ) : null}
            <View style={styles.cardActions}>
              {ticker ? (
                <Pressable style={styles.miniBtn} onPress={() => void onSave()}>
                  <Text style={styles.miniBtnText}>☆ Save</Text>
                </Pressable>
              ) : null}
              {top ? (
                <Pressable style={styles.miniBtn} onPress={openDetail}>
                  <Text style={styles.miniBtnText}>Open · Research</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.miniBtn} onPress={retake}>
                <Text style={styles.miniBtnText}>Retake</Text>
              </Pressable>
            </View>
            {savedNote ? <Text style={styles.queued}>{savedNote}</Text> : null}
            {queuedNote ? <Text style={styles.queued}>{queuedNote}</Text> : null}
            {err ? <Text style={styles.err}>{err}</Text> : null}
          </View>
        ) : err ? (
          <View style={styles.resultCard}>
            <Text style={styles.err}>{err}</Text>
          </View>
        ) : null}

        <View style={styles.controls}>
          {frozenUri ? (
            <Pressable style={styles.secondary} onPress={retake}>
              <Text style={styles.secondaryText}>Retake</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void capture()}
              disabled={busy}
              accessibilityLabel="Capture photo"
              style={[styles.shutter, busy && { opacity: 0.5 }]}
            />
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  hud: { flex: 1, justifyContent: "space-between" },
  statusRow: {
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  status: {
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 12,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  controls: { alignItems: "center", paddingBottom: 24 },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#fff",
    borderColor: "rgba(255,255,255,0.3)",
    borderWidth: 6,
  },
  secondary: {
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  secondaryText: { color: "#000", fontWeight: "700" },
  resultCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.78)",
    gap: 8,
  },
  resultTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  resultSubtitle: { color: "#ccc", fontSize: 13, marginTop: 2 },
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  miniBtn: {
    backgroundColor: "#1a1a1a",
    borderColor: "#333",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  miniBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  queued: { color: "#ffd77a", fontSize: 12, marginTop: 4 },
  err: { color: "#ff5a5a", fontSize: 12, marginTop: 4 },
  msg: { color: "#fff", padding: 24, textAlign: "center" },
  btn: { backgroundColor: "#fff", padding: 12, borderRadius: 8 },
  btnText: { color: "#000", fontWeight: "700" },
});
