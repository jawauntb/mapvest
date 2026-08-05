import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { addToWatchlist, identifyPhoto } from "@/api/client";
import type { IdentifyResponse, LatLng } from "@/api/types";
import { useSession } from "@/auth/session";
import { enqueuePhoto } from "@/queue/photoQueue";
import { useNetworkSync } from "@/queue/useNetworkSync";
import { sectorColor } from "@/util/sectors";

/** Capture freezes the frame with the ticker — camera does not stay live. */
export default function CameraScreen() {
  const [perm, requestPerm] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const router = useRouter();
  const { session } = useSession();
  const { online, pending } = useNetworkSync({ token: session?.token });
  const [busy, setBusy] = useState(false);
  const [frozenUri, setFrozenUri] = useState<string | null>(null);
  const [result, setResult] = useState<IdentifyResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [queuedNote, setQueuedNote] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

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
    if (!cameraRef.current || busy) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    setQueuedNote(null);
    setSavedNote(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        skipProcessing: true,
      });
      if (!photo?.uri) throw new Error("No photo captured.");
      // Freeze immediately so the camera does not stay live.
      setFrozenUri(photo.uri);
      const location = await currentLocation();

      if (!online) {
        await enqueuePhoto({ imageUri: photo.uri, location });
        setQueuedNote("Offline — queued. Will upload when back online.");
        return;
      }

      try {
        const resp = await identifyPhoto(
          { imageUri: photo.uri, location },
          { token: session?.token },
        );
        setResult(resp);
      } catch (e) {
        await enqueuePhoto({ imageUri: photo.uri, location });
        setQueuedNote("Upload failed — queued for retry.");
        setErr(e instanceof Error ? e.message : String(e));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
  }

  const top = result?.investables[0];
  const ticker =
    top?.brand.ticker?.symbol ??
    top?.comparables?.[0]?.ticker ??
    undefined;
  const accent = sectorColor(top?.brand.sector);

  async function onSave() {
    if (!ticker || !session?.token || !top) return;
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
    else if (top?.brand.name)
      router.push(`/detail/${encodeURIComponent(top.brand.name)}`);
  }

  return (
    <View style={styles.root}>
      {frozenUri ? (
        <Image source={{ uri: frozenUri }} style={StyleSheet.absoluteFillObject} />
      ) : (
        <CameraView
          ref={(r) => {
            cameraRef.current = r;
          }}
          style={StyleSheet.absoluteFillObject}
          facing="back"
        />
      )}
      <SafeAreaView style={styles.hud} edges={["top", "bottom"]}>
        <View style={styles.statusRow}>
          <Text style={styles.status}>
            {frozenUri ? "Frozen" : online ? "Online" : "Offline"}{" "}
            {pending.length ? `· ${pending.length} queued` : ""}
          </Text>
        </View>

        <View style={styles.center}>
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
