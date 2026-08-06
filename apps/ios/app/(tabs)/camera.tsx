import { addToWatchlist, identifyPhoto } from "@/api/client";
import type { Confidence, Detection, IdentifyResponse, LatLng } from "@/api/types";
import { useSession } from "@/auth/session";
import { captureStill } from "@/camera/captureStill";
import { CameraDetectionOverlay } from "@/components/CameraDetectionOverlay";
import { PhotoAnnotator } from "@/components/PhotoAnnotator";
import { PrimaryButton } from "@/components/PrimaryButton";
import { enqueuePhoto } from "@/queue/photoQueue";
import { useNetworkSync } from "@/queue/useNetworkSync";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect, hapticSuccess, hapticTap } from "@/util/haptics";
import { pickFromLibrary } from "@/util/pickImage";
import { sectorColor } from "@/util/sectors";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { BlurView } from "expo-blur";
import { CameraView, useCameraPermissions } from "expo-camera";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
  const readySinceRef = useRef<number | null>(null);
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
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  // `pendingUri` gates the annotator. When set, we render <PhotoAnnotator>
  // full-screen over the camera and only kick off identify once the user
  // confirms. Applies to BOTH capture and library-picked photos.
  const [pendingUri, setPendingUri] = useState<string | null>(null);

  function onPreviewLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setPreviewSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  }

  // Drop stale ready flag when CameraView unmounts (tab blur / frozen frame).
  useEffect(() => {
    if (!focused || frozenUri) {
      readyRef.current = false;
      readySinceRef.current = null;
    }
  }, [focused, frozenUri]);

  // Coerce the identify response into a `Detection[]`. If the API already
  // returns `detections` (forward-compat path), use them; otherwise synthesize
  // a single centered detection from the top investable so users still get the
  // glow-box treatment.
  //
  // NOTE: This useMemo MUST live above the permission-gated early returns so
  // the hook count stays stable across renders (Rules of Hooks). Previously
  // it sat below and the first render — when perm is still `null` — bailed
  // before ever calling this hook, so as soon as perm loaded React tripped
  // "Rendered more hooks than during the previous render." That crash is what
  // made the camera tab appear "broken" after the PhotoAnnotator wiring.
  const detections = useMemo<Detection[]>(
    () => coerceDetections(result),
    [result],
  );

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
      <View style={styles.permRoot}>
        <ActivityIndicator color={colors.fg} />
      </View>
    );
  }
  if (!perm.granted) {
    return (
      <SafeAreaView style={styles.permRoot}>
        <View style={styles.permIcon}>
          <Ionicons name="camera-outline" size={30} color={colors.fgMuted} />
        </View>
        <Text style={styles.msg}>Mapvest needs camera access.</Text>
        <PrimaryButton label="Grant access" onPress={requestPerm} style={{ marginTop: 16 }} />
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
    const cam = cameraRef.current;
    if (!cam) {
      setErr("Camera still starting — wait a sec and tap again.");
      return;
    }
    hapticTap();
    setBusy(true);
    setErr(null);
    setResult(null);
    setQueuedNote(null);
    setSavedNote(null);
    try {
      const photo = await captureStill(cam, { readySince: readySinceRef.current });
      // Hand off to the annotator instead of identifying immediately —
      // the user gets to draw an ROI + type a hint before we upload.
      setPendingUri(photo.uri);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || "Capture failed");
      persistCamera({ err: msg });
    } finally {
      setBusy(false);
    }
  }

  async function pickLibrary() {
    if (busy) return;
    hapticTap();
    try {
      const uri = await pickFromLibrary();
      if (!uri) return;
      // Same annotator flow as fresh capture.
      setErr(null);
      setResult(null);
      setQueuedNote(null);
      setSavedNote(null);
      setPendingUri(uri);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open library");
    }
  }

  /**
   * Run identify with optional ROI + hint. Shared by the annotator's Scan
   * path for both freshly captured and library-picked photos. Falls back to
   * enqueue on network failure / offline just like the original inline
   * flow did.
   */
  async function runIdentify(args: {
    imageUri: string;
    roi?: { xN: number; yN: number; rN: number };
    hint?: string;
  }) {
    setBusy(true);
    setErr(null);
    setResult(null);
    setQueuedNote(null);
    setSavedNote(null);
    setFrozenUri(args.imageUri);
    persistCamera({
      frozenUri: args.imageUri,
      result: null,
      err: null,
      queuedNote: null,
    });
    const location = await currentLocation();
    try {
      if (!online) {
        await enqueuePhoto({ imageUri: args.imageUri, location });
        const note = "Offline — queued. Will upload when back online.";
        setQueuedNote(note);
        persistCamera({ queuedNote: note });
        return;
      }
      try {
        const resp = await identifyPhoto(
          {
            imageUri: args.imageUri,
            location,
            roi: args.roi,
            hint: args.hint,
          },
          { token: session?.token },
        );
        setResult(resp);
        persistCamera({ result: resp, err: null });
      } catch (e) {
        await enqueuePhoto({ imageUri: args.imageUri, location });
        const msg = e instanceof Error ? e.message : String(e);
        setQueuedNote("Upload failed — queued for retry.");
        setErr(msg);
        persistCamera({
          queuedNote: "Upload failed — queued for retry.",
          err: msg,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  function retake() {
    hapticSelect();
    setFrozenUri(null);
    setResult(null);
    setErr(null);
    setQueuedNote(null);
    setSavedNote(null);
    readyRef.current = false;
    readySinceRef.current = null;
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
      hapticSuccess();
      setSavedNote(`Saved $${ticker}`);
    } catch (e) {
      setSavedNote(null);
      setErr(e instanceof Error ? e.message : "save failed");
    }
  }

  function openDetail() {
    if (ticker) router.push(`/detail/${ticker}`);
    else if (top?.brand.name) router.push(`/detail/${encodeURIComponent(top.brand.name)}`);
  }

  // Only mount while focused so blurred tabs cannot hold the camera session.
  const showLivePreview = focused && !frozenUri;

  // Full-screen annotator takes over once we have a pending photo (captured
  // or library-picked). Returning early keeps the CameraView unmounted
  // while the modal is up, which frees the AVFoundation session.
  if (pendingUri) {
    return (
      <PhotoAnnotator
        imageUri={pendingUri}
        onCancel={() => setPendingUri(null)}
        onConfirm={(opts) => {
          setPendingUri(null);
          void runIdentify(opts);
        }}
      />
    );
  }

  return (
    <View style={styles.root} onLayout={onPreviewLayout}>
      {frozenUri ? (
        <Image source={{ uri: frozenUri }} style={StyleSheet.absoluteFillObject} />
      ) : showLivePreview ? (
        <CameraView
          ref={(r) => {
            cameraRef.current = r;
          }}
          style={StyleSheet.absoluteFillObject}
          facing="back"
          active={focused && !frozenUri}
          onCameraReady={() => {
            readyRef.current = true;
            readySinceRef.current = Date.now();
          }}
          onMountError={(e) => {
            readyRef.current = false;
            readySinceRef.current = null;
            setErr(e.message || "Camera failed to start");
          }}
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.center]}>
          <Text style={styles.msg}>Opening camera…</Text>
        </View>
      )}
      {frozenUri && detections.length > 0 ? (
        <CameraDetectionOverlay detections={detections} containerSize={previewSize} />
      ) : null}
      <SafeAreaView style={styles.hud} edges={["top", "bottom"]} pointerEvents="box-none">
        <View style={styles.statusRow} pointerEvents="none">
          <BlurView intensity={40} tint="dark" style={styles.statusPill}>
            <Ionicons
              name={frozenUri ? "image" : online ? "wifi" : "cloud-offline-outline"}
              size={12}
              color={colors.fg}
            />
            <Text style={styles.status}>
              {frozenUri ? "Frozen" : online ? "Online" : "Offline"}
              {pending.length ? ` · ${pending.length} queued` : ""}
            </Text>
          </BlurView>
        </View>

        <View style={styles.center} pointerEvents="none">
          {busy ? <ActivityIndicator color={colors.fg} size="large" /> : null}
        </View>

        {result || err || queuedNote ? (
          <BlurView
            intensity={50}
            tint="dark"
            style={[styles.resultCard, { borderLeftColor: accent, borderLeftWidth: 3 }]}
          >
            {top ? (
              <Pressable
                onPress={openDetail}
                accessibilityRole="button"
                accessibilityLabel={`Open ${top.brand.name}`}
              >
                <Text style={styles.resultTitle}>{top.brand.name}</Text>
                <Text style={styles.resultSubtitle}>
                  {ticker ? `$${ticker}` : "private"} · {top.confidence}
                  {top.brand.sector ? ` · ${top.brand.sector}` : ""}
                </Text>
              </Pressable>
            ) : null}
            <View style={styles.cardActions}>
              {ticker ? (
                <Pressable
                  style={styles.miniBtn}
                  onPress={() => void onSave()}
                  accessibilityRole="button"
                  accessibilityLabel={`Save ${ticker} to watchlist`}
                >
                  <Ionicons name="star-outline" size={13} color={colors.accent} />
                  <Text style={styles.miniBtnText}>Save</Text>
                </Pressable>
              ) : null}
              {top ? (
                <Pressable
                  style={styles.miniBtn}
                  onPress={openDetail}
                  accessibilityRole="button"
                  accessibilityLabel="Open research"
                >
                  <Ionicons name="document-text-outline" size={13} color={colors.accent} />
                  <Text style={styles.miniBtnText}>Research</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={styles.miniBtn}
                onPress={retake}
                accessibilityRole="button"
                accessibilityLabel="Retake photo"
              >
                <Ionicons name="refresh-outline" size={13} color={colors.accent} />
                <Text style={styles.miniBtnText}>Retake</Text>
              </Pressable>
            </View>
            {savedNote ? <Text style={styles.queued}>{savedNote}</Text> : null}
            {queuedNote ? <Text style={styles.queued}>{queuedNote}</Text> : null}
            {err ? <Text style={styles.err}>{err}</Text> : null}
          </BlurView>
        ) : err ? (
          <BlurView intensity={50} tint="dark" style={styles.resultCard}>
            <Text style={styles.err}>{err}</Text>
          </BlurView>
        ) : null}

        <View style={styles.controls}>
          {frozenUri ? (
            <Pressable
              style={styles.secondary}
              onPress={retake}
              accessibilityRole="button"
              accessibilityLabel="Retake photo"
            >
              <Ionicons name="refresh" size={16} color={colors.bg} />
              <Text style={styles.secondaryText}>Retake</Text>
            </Pressable>
          ) : (
            <View style={styles.captureRow}>
              {/* Spacer keeps the shutter visually centered while the
                  Library pill anchors to the right. */}
              <View style={styles.captureSide} />
              <Pressable
                onPress={() => void capture()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Capture photo"
                style={[styles.shutterRing, busy && { opacity: 0.5 }]}
              >
                <LinearGradient
                  colors={colors.gradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.shutterGrad}
                >
                  <View style={styles.shutterInner} />
                </LinearGradient>
              </Pressable>
              <View style={styles.captureSide}>
                <Pressable
                  onPress={() => void pickLibrary()}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Pick from library"
                  style={[styles.libraryBtn, busy && { opacity: 0.5 }]}
                >
                  <Ionicons name="images-outline" size={16} color={colors.fg} />
                  <Text style={styles.libraryBtnText}>Library</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

/**
 * Map the categorical `Confidence` enum to a numeric [0,1] value so
 * synthesized detections can drive the overlay's opacity ramp.
 */
function confidenceToNumber(c: Confidence | undefined): number {
  if (c === "high") return 0.9;
  if (c === "medium") return 0.65;
  if (c === "low") return 0.4;
  return 0.6;
}

/**
 * Coerce an identify response into a `Detection[]`. Preserves any
 * server-provided detections (forward-compat) and otherwise synthesizes
 * a single centered detection from the top investable so the overlay
 * still has something to render.
 */
function coerceDetections(resp: IdentifyResponse | null): Detection[] {
  if (!resp) return [];
  if (resp.detections && resp.detections.length > 0) {
    return resp.detections.slice(0, 3);
  }
  const inv = resp.investables[0];
  if (!inv) return [];
  const ticker = inv.brand.ticker?.symbol ?? inv.comparables?.[0]?.ticker;
  if (!ticker) return [];
  return [
    {
      // Centered ROI box — ~60% wide, ~40% tall, placed mid-frame.
      box: { x: 0.2, y: 0.3, w: 0.6, h: 0.4 },
      ticker,
      name: inv.brand.name,
      confidence: confidenceToNumber(inv.confidence),
    },
  ];
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hud: { flex: 1, justifyContent: "space-between" },
  statusRow: {
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    overflow: "hidden",
  },
  status: {
    color: colors.fg,
    fontSize: 12,
    fontWeight: "600",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  permRoot: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  controls: { alignItems: "center", paddingBottom: 24 },
  captureRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: 32,
  },
  captureSide: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  libraryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.bgGlass,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    minHeight: 36,
  },
  libraryBtnText: { color: colors.fg, fontSize: 13, fontWeight: "700" },
  shutterRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    padding: 5,
  },
  shutterGrad: {
    flex: 1,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.bg,
  },
  secondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.fg,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radii.pill,
    minHeight: 44,
  },
  secondaryText: { color: colors.bg, fontWeight: "700" },
  resultCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    borderRadius: radii.lg,
    overflow: "hidden",
    gap: 8,
  },
  resultTitle: { color: colors.fg, ...type.h3, fontSize: 18 },
  resultSubtitle: { color: colors.fgMuted, fontSize: 13, marginTop: 2 },
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  miniBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.bgGlass,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 32,
  },
  miniBtnText: { color: colors.fg, fontSize: 13, fontWeight: "600" },
  queued: { color: colors.warn, fontSize: 12, marginTop: 4 },
  err: { color: colors.danger, fontSize: 12, marginTop: 4 },
  msg: { color: colors.fg, padding: 24, textAlign: "center" },
  permIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
});
