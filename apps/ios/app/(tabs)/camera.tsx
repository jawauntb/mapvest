import { type Quote, addToWatchlist, identifyPhoto } from "@/api/client";
import type { Confidence, IdentifyResponse, Investable, LatLng } from "@/api/types";
import { authSavePath } from "@/auth/saveContinuation";
import { useSession } from "@/auth/session";
import { presentPaywallIfQuota, usePaywall } from "@/billing/Paywall";
import { ENTITLEMENTS_QUERY_KEY, useEntitlements } from "@/billing/useEntitlements";
import { captureStill } from "@/camera/captureStill";
import {
  type IdentifyProgressStage,
  identifyProgressCopy,
  investableLabel,
  investableTicker,
  splitInvestableResults,
} from "@/camera/resultPresentation";
import {
  type CameraResultScope,
  cameraResultCacheKey,
  cameraResultScope,
  canApplyCameraResult,
} from "@/camera/resultScope";
import { CameraDetectionOverlay, type OverlayDetection } from "@/components/CameraDetectionOverlay";
import { EvidenceSection } from "@/components/EvidenceSection";
import { FindEvolutionNudge } from "@/components/FindEvolutionNudge";
import { PhotoAnnotator } from "@/components/PhotoAnnotator";
import { PrimaryButton } from "@/components/PrimaryButton";
import { markFindRefreshPending } from "@/finds/focusRefresh";
import { openChatAbout } from "@/nav/chatAbout";
import { enqueuePhoto, queueScopeForUser } from "@/queue/photoQueue";
import { useNetworkSync } from "@/queue/useNetworkSync";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect, hapticSuccess, hapticTap } from "@/util/haptics";
import { pickFromLibrary } from "@/util/pickImage";
import { sectorColor } from "@/util/sectors";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { BlurView } from "expo-blur";
import { CameraView, useCameraPermissions } from "expo-camera";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

type CameraCache = {
  frozenUri: string | null;
  result: IdentifyResponse | null;
  err: string | null;
  queuedNote: string | null;
  savedNote: string | null;
};

type IdentifyOperation = {
  id: number;
  scope: CameraResultScope;
  authGeneration: number;
  sessionToken?: string;
  queueScope: ReturnType<typeof queueScopeForUser>;
  controller: AbortController;
};

/** Capture freezes the frame with the ticker — camera does not stay live. */
export default function CameraScreen() {
  const focused = useIsFocused();
  const { height: windowHeight } = useWindowDimensions();
  const [perm, requestPerm] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const readyRef = useRef(false);
  const readySinceRef = useRef<number | null>(null);
  const router = useRouter();
  const params = useLocalSearchParams<{ intent?: string }>();
  const qc = useQueryClient();
  const { session, user, authGeneration, isActiveSession, isAuthGenerationCurrent } = useSession();
  const { presentPaywall } = usePaywall();
  const entitlementsQ = useEntitlements();
  const queueScope = useMemo(() => queueScopeForUser(session?.userId), [session?.userId]);
  const { online, pending, legacyCount, recovery, resetRecovery } = useNetworkSync({
    token: session?.token,
    userId: session?.userId,
    authGeneration,
  });
  const activeScope = cameraResultScope(user?.id);
  const activeScopeRef = useRef(activeScope);
  // Keep this in sync during render, before effects run, so an identify
  // response that settles in the guest→account render gap is still rejected.
  activeScopeRef.current = activeScope;
  const lastScopeRef = useRef(activeScope);
  const lastAuthGenerationRef = useRef(authGeneration);
  const identifyOperationRef = useRef(0);
  const identifyAbortRef = useRef<AbortController | null>(null);
  const activeSessionRef = useRef({ authGeneration, token: session?.token });
  activeSessionRef.current = { authGeneration, token: session?.token };
  const cached = qc.getQueryData<CameraCache>(cameraResultCacheKey(activeScope));
  const [stateScope, setStateScope] = useState<CameraResultScope>(activeScope);
  const [stateAuthGeneration, setStateAuthGeneration] = useState(authGeneration);
  const [busy, setBusy] = useState(false);
  const [authSaveNavigationPending, setAuthSaveNavigationPending] = useState(false);
  const authSaveNavigationRef = useRef(false);
  const [identifyStage, setIdentifyStage] = useState<IdentifyProgressStage>("preparing");
  // Never restore a frozen frame on mount — Camera means take a new picture.
  const [frozenUriValue, setFrozenUri] = useState<string | null>(null);
  const [resultValue, setResult] = useState<IdentifyResponse | null>(cached?.result ?? null);
  const [errValue, setErr] = useState<string | null>(cached?.err ?? null);
  const [queuedNoteValue, setQueuedNote] = useState<string | null>(cached?.queuedNote ?? null);
  const [savedNoteValue, setSavedNote] = useState<string | null>(cached?.savedNote ?? null);
  const [resettingQueueRecovery, setResettingQueueRecovery] = useState(false);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  // `pendingUri` gates the optional Refine annotator. When set, we render
  // <PhotoAnnotator> full-screen seeded with the frozen photo; its Scan
  // re-runs identify with roi + hint. Cancel returns to the result card.
  const [pendingUriValue, setPendingUri] = useState<string | null>(null);
  const stateBelongsToActiveIdentity =
    stateScope === activeScope && stateAuthGeneration === authGeneration;
  // The account transition effect below clears this state after commit. These
  // guards hide it one render earlier, so no guest/A result can flash on B.
  const frozenUri = stateBelongsToActiveIdentity ? frozenUriValue : null;
  const result = stateBelongsToActiveIdentity ? resultValue : null;
  const err = stateBelongsToActiveIdentity ? errValue : null;
  const queuedNote = stateBelongsToActiveIdentity ? queuedNoteValue : null;
  const savedNote = stateBelongsToActiveIdentity ? savedNoteValue : null;
  const pendingUri = stateBelongsToActiveIdentity ? pendingUriValue : null;
  // Leave room for the fixed capture/retake controls even on an iPhone SE;
  // the one outer result scroller owns vertical movement for the whole card.
  const resultRegionMaxHeight = Math.max(260, Math.min(480, Math.round(windowHeight * 0.54)));

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

  // Coerce the identify response into overlay detections. If the API already
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
  const detections = useMemo<OverlayDetection[]>(() => coerceDetections(result), [result]);

  const persistCamera = useCallback(
    (next: Partial<CameraCache>, scope: CameraResultScope = activeScopeRef.current) => {
      if (!canApplyCameraResult(scope, activeScopeRef.current)) return;
      const key = cameraResultCacheKey(scope);
      const prev = qc.getQueryData<CameraCache>(key) ?? {
        frozenUri: null,
        result: null,
        err: null,
        queuedNote: null,
        savedNote: null,
      };
      qc.setQueryData<CameraCache>(key, { ...prev, ...next });
    },
    [qc],
  );

  const resetToLive = useCallback(() => {
    identifyOperationRef.current += 1;
    identifyAbortRef.current?.abort();
    identifyAbortRef.current = null;
    setStateScope(activeScopeRef.current);
    setStateAuthGeneration(activeSessionRef.current.authGeneration);
    setFrozenUri(null);
    setPendingUri(null);
    setBusy(false);
    setErr(null);
    setResult(null);
    persistCamera({ frozenUri: null, err: null }, activeScopeRef.current);
  }, [persistCamera]);

  useEffect(() => {
    const previousScope = lastScopeRef.current;
    const previousAuthGeneration = lastAuthGenerationRef.current;
    if (previousScope === activeScope && previousAuthGeneration === authGeneration) return;
    lastScopeRef.current = activeScope;
    lastAuthGenerationRef.current = authGeneration;
    // The authenticated Camera tab stays mounted, so explicitly invalidate
    // both a late request and the old identity's cached photo/result.
    if (previousScope !== activeScope) {
      qc.removeQueries({ queryKey: cameraResultCacheKey(previousScope), exact: true });
    }
    resetToLive();
  }, [activeScope, authGeneration, qc, resetToLive]);

  // Opening Camera always means "take a new picture". Last identify stays
  // in the query cache as a Last snap chip, not as a stuck frozen frame.
  useFocusEffect(
    useCallback(() => {
      // A cancelled/failed push leaves this tab in place; re-enable Save when
      // it regains focus instead of leaving the control permanently locked.
      authSaveNavigationRef.current = false;
      setAuthSaveNavigationPending(false);
      resetToLive();
    }, [resetToLive]),
  );

  useEffect(() => {
    if (params.intent === "snap") {
      resetToLive();
      router.setParams({ intent: undefined } as never);
    }
  }, [params.intent, resetToLive, router]);

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

  function startIdentifyOperation(): IdentifyOperation {
    identifyAbortRef.current?.abort();
    const controller = new AbortController();
    const operation = {
      id: ++identifyOperationRef.current,
      scope: activeScopeRef.current,
      authGeneration: authGeneration,
      sessionToken: session?.token,
      queueScope,
      controller,
    };
    identifyAbortRef.current = controller;
    setStateScope(operation.scope);
    setStateAuthGeneration(operation.authGeneration);
    setBusy(true);
    setIdentifyStage("preparing");
    setErr(null);
    setResult(null);
    setQueuedNote(null);
    setSavedNote(null);
    return operation;
  }

  function isCurrentIdentifyOperation(operation: IdentifyOperation): boolean {
    const activeSession = activeSessionRef.current;
    return (
      operation.id === identifyOperationRef.current &&
      !operation.controller.signal.aborted &&
      canApplyCameraResult(operation.scope, activeScopeRef.current) &&
      operation.authGeneration === activeSession.authGeneration &&
      isAuthGenerationCurrent(operation.authGeneration) &&
      (operation.sessionToken
        ? activeSession.token === operation.sessionToken &&
          isActiveSession(operation.authGeneration, operation.sessionToken)
        : activeSession.token === undefined)
    );
  }

  function finishIdentifyOperation(operation: IdentifyOperation) {
    if (isCurrentIdentifyOperation(operation)) setBusy(false);
    if (identifyAbortRef.current === operation.controller) identifyAbortRef.current = null;
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
    const operation = startIdentifyOperation();
    try {
      const photo = await captureStill(cam, { readySince: readySinceRef.current });
      await runIdentify({ imageUri: photo.uri }, operation);
    } catch (e) {
      if (!isCurrentIdentifyOperation(operation)) return;
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || "Capture failed");
      persistCamera({ err: msg }, operation.scope);
    } finally {
      finishIdentifyOperation(operation);
    }
  }

  async function pickLibrary() {
    if (busy) return;
    hapticTap();
    const operation = startIdentifyOperation();
    try {
      const uri = await pickFromLibrary();
      if (!uri || !isCurrentIdentifyOperation(operation)) return;
      await runIdentify({ imageUri: uri }, operation);
    } catch (e) {
      if (!isCurrentIdentifyOperation(operation)) return;
      setErr(e instanceof Error ? e.message : "Could not open library");
    } finally {
      finishIdentifyOperation(operation);
    }
  }

  /**
   * Run identify for a captured or library-picked photo. Fresh snaps call
   * this immediately with just the uri; the Refine annotator re-runs it
   * with roi + hint. Falls back to enqueue on network failure / offline.
   */
  async function runIdentify(
    args: {
      imageUri: string;
      roi?: { xN: number; yN: number; rN: number };
      hint?: string;
    },
    operation: IdentifyOperation = startIdentifyOperation(),
  ) {
    if (!isCurrentIdentifyOperation(operation)) return;
    setFrozenUri(args.imageUri);
    persistCamera(
      {
        frozenUri: args.imageUri,
        result: null,
        err: null,
        queuedNote: null,
      },
      operation.scope,
    );
    const location = await currentLocation();
    if (!isCurrentIdentifyOperation(operation)) {
      finishIdentifyOperation(operation);
      return;
    }
    const queueCapture = async (): Promise<boolean> => {
      if (!isCurrentIdentifyOperation(operation)) return false;
      try {
        await enqueuePhoto({
          imageUri: args.imageUri,
          location,
          scope: operation.queueScope,
        });
        return isCurrentIdentifyOperation(operation);
      } catch (queueError) {
        if (!isCurrentIdentifyOperation(operation)) return false;
        const message = queueError instanceof Error ? queueError.message : String(queueError);
        const queueFailure = `Couldn't safely queue this snap: ${message}`;
        setErr(queueFailure);
        persistCamera({ err: queueFailure, queuedNote: null }, operation.scope);
        return false;
      }
    };
    try {
      if (!online) {
        if (!(await queueCapture())) return;
        const note = "Queued — finishing when you're back online.";
        setQueuedNote(note);
        persistCamera({ queuedNote: note }, operation.scope);
        return;
      }
      try {
        // This is the first point the client knows the identify request has
        // started. Server-side vision and finance work do not emit progress,
        // so the UI intentionally keeps the final match step pending.
        setIdentifyStage("identifying");
        const resp = await identifyPhoto(
          {
            imageUri: args.imageUri,
            location,
            roi: args.roi,
            hint: args.hint,
          },
          {
            token: operation.scope === "guest" ? undefined : operation.sessionToken,
            signal: operation.controller.signal,
          },
        );
        if (!isCurrentIdentifyOperation(operation)) return;
        setResult(resp);
        persistCamera({ result: resp, err: null }, operation.scope);
        void qc.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY });
        if (operation.sessionToken && resp.investables.length > 0) {
          markFindRefreshPending(operation.sessionToken);
        }
        if (resp.investables.length > 0) hapticSuccess();
      } catch (e) {
        if (!isCurrentIdentifyOperation(operation)) return;
        if (presentPaywallIfQuota(e, presentPaywall)) {
          setErr("Free generations used. Subscribe to keep identifying.");
          persistCamera({ err: "quota_exceeded" }, operation.scope);
          return;
        }
        if (!(await queueCapture())) return;
        const msg = e instanceof Error ? e.message : String(e);
        const failNote =
          "That didn't go through. Your snap is queued and will finish on its own — or retake now.";
        setQueuedNote(failNote);
        setErr(msg);
        persistCamera({ queuedNote: failNote, err: msg }, operation.scope);
      }
    } finally {
      finishIdentifyOperation(operation);
    }
  }

  function retake() {
    hapticSelect();
    identifyOperationRef.current += 1;
    identifyAbortRef.current?.abort();
    identifyAbortRef.current = null;
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

  async function discardUnrecoverableQueue() {
    if (!recovery?.quarantined || resettingQueueRecovery) return;
    setResettingQueueRecovery(true);
    try {
      await resetRecovery();
      const note =
        "Unreadable offline queue discarded. Its private recovery copy stays on this device.";
      setQueuedNote(note);
      setErr(null);
      persistCamera({ queuedNote: note, err: null });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const queueFailure = `Couldn't discard the protected offline queue: ${message}`;
      setErr(queueFailure);
      persistCamera({ err: queueFailure });
    } finally {
      setResettingQueueRecovery(false);
    }
  }

  const { primary: top, additional: additionalInvestables } = splitInvestableResults(
    result?.investables,
  );
  const ticker = top ? investableTicker(top) : undefined;
  const accent = sectorColor(top?.brand.sector);
  // `quote` is attached best-effort by /v1/identify (packages/core schema);
  // the local Investable re-declaration doesn't carry the field yet.
  const quote = top ? (top as Investable & { quote?: Quote }).quote : undefined;
  const meaning = meaningLine(top);

  async function onSave() {
    if (!ticker || !top) return;
    const saveScope = activeScopeRef.current;
    if (!session?.token) {
      if (authSaveNavigationRef.current) return;
      authSaveNavigationRef.current = true;
      setAuthSaveNavigationPending(true);
      try {
        router.push(
          authSavePath({
            ticker,
            name: top.brand.name,
            sector: top.brand.sector,
            source: "camera",
          }) as never,
        );
      } catch {
        authSaveNavigationRef.current = false;
        setAuthSaveNavigationPending(false);
      }
      return;
    }
    setSavedNote(`Saving ${ticker}…`);
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
      if (!canApplyCameraResult(saveScope, activeScopeRef.current)) return;
      hapticSuccess();
      setSavedNote(`Saved ${ticker}`);
    } catch (e) {
      if (!canApplyCameraResult(saveScope, activeScopeRef.current)) return;
      setSavedNote(null);
      setErr(e instanceof Error ? e.message : "save failed");
    }
  }

  function openDetail(investable: Investable) {
    const id = investableTicker(investable) ?? investable.brand.name;
    router.push(`/detail/${encodeURIComponent(id)}`);
  }

  function openPrimaryDetail() {
    if (top) openDetail(top);
  }

  function openResearch() {
    if (!top) return;
    const researchTicker = investableTicker(top);
    if (researchTicker) {
      openChatAbout(router, { kind: "ticker", ticker: researchTicker });
      return;
    }
    // A brand without a public match cannot seed ticker research honestly.
    // Keep the existing detail route available for its comparable context.
    openDetail(top);
  }

  function refine() {
    if (!frozenUri) return;
    hapticSelect();
    setPendingUri(frozenUri);
  }

  // Only mount while focused so blurred tabs cannot hold the camera session.
  const showLivePreview = focused && !frozenUri;

  // Full-screen Refine annotator. Returning early keeps the CameraView
  // unmounted while it's up, which frees the AVFoundation session.
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
        <View pointerEvents="none">
          {!online ? (
            <View style={styles.statusRow}>
              <BlurView intensity={40} tint="dark" style={styles.statusPill}>
                <Ionicons name="cloud-offline-outline" size={12} color={colors.fg} />
                <Text style={styles.status}>
                  Offline — we'll finish this find when you're back.
                </Text>
              </BlurView>
            </View>
          ) : null}
          {pending.length > 0 ? (
            <View style={styles.statusRow}>
              <BlurView intensity={40} tint="dark" style={styles.statusPill}>
                <Ionicons name="cloud-upload-outline" size={12} color={colors.fg} />
                <Text style={styles.status}>
                  {pending.length} {pending.length === 1 ? "snap" : "snaps"} queued for{" "}
                  {session?.userId ? "this account" : "guest mode"}.
                </Text>
              </BlurView>
            </View>
          ) : null}
          {legacyCount > 0 ? (
            <View style={styles.statusRow}>
              <BlurView intensity={40} tint="dark" style={styles.statusPill}>
                <Ionicons name="shield-checkmark-outline" size={12} color={colors.fg} />
                <Text style={styles.status}>
                  {legacyCount} older {legacyCount === 1 ? "snap is" : "snaps are"} protected and
                  won't upload. Retake to send {legacyCount === 1 ? "it" : "them"}.
                </Text>
              </BlurView>
            </View>
          ) : null}
          {!frozenUri && !result && !busy && !err ? (
            <View style={styles.lessonRow}>
              <BlurView intensity={40} tint="dark" style={styles.statusPill}>
                <Text style={styles.status}>Point at anything with a name on it.</Text>
              </BlurView>
            </View>
          ) : null}
        </View>
        {entitlementsQ.data && !entitlementsQ.data.freeForever && !entitlementsQ.data.subscribed ? (
          <View style={styles.lessonRow}>
            <Pressable
              onPress={() => presentPaywall()}
              accessibilityRole="button"
              accessibilityLabel={`${entitlementsQ.data.remaining} of ${entitlementsQ.data.limit} free generations left`}
            >
              <BlurView intensity={40} tint="dark" style={styles.statusPill}>
                <Text style={styles.status}>
                  {entitlementsQ.data.remaining} of {entitlementsQ.data.limit} free left
                </Text>
              </BlurView>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.center} pointerEvents="none">
          {busy ? <IdentifyProgress stage={identifyStage} /> : null}
        </View>

        {result || err || queuedNote || recovery ? (
          <View style={[styles.resultRegion, { maxHeight: resultRegionMaxHeight }]}>
            <ScrollView
              style={styles.resultScroll}
              contentContainerStyle={styles.resultScrollContent}
              showsVerticalScrollIndicator
              bounces
              accessibilityLabel="Identification result. Swipe to review matches, evidence, and actions."
            >
              <CardEntrance>
                <BlurView
                  intensity={50}
                  tint="dark"
                  style={[styles.resultCard, { borderLeftColor: accent, borderLeftWidth: 3 }]}
                >
                  {top ? (
                    <>
                      <View style={styles.titleRow}>
                        <Text style={styles.resultTitle} numberOfLines={1}>
                          {top.brand.name}
                        </Text>
                        <View style={styles.confidencePill}>
                          <Text style={styles.confidencePillText}>
                            {confidenceLabel(top.confidence)}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.resultSubtitle}>
                        {ticker ? ticker : "Private"}
                        {top.brand.sector ? ` · ${top.brand.sector}` : ""}
                      </Text>
                      {meaning ? <Text style={styles.meaning}>{meaning}</Text> : null}
                      {quote ? (
                        <Text style={styles.priceLine}>
                          ${quote.price.toFixed(2)}{" "}
                          <Text
                            style={{ color: quote.change >= 0 ? colors.accent : colors.danger }}
                          >
                            {quote.change >= 0 ? "+" : ""}
                            {quote.changePct.toFixed(1)}% today
                          </Text>
                        </Text>
                      ) : null}
                    </>
                  ) : null}
                  {result && !top ? (
                    <View
                      accessibilityRole="summary"
                      accessibilityLabel="No investable brand found. Try refining or retaking this photo."
                    >
                      <View style={styles.noMatchHeading}>
                        <Ionicons name="scan-outline" size={18} color={colors.warn} />
                        <Text style={styles.resultTitle}>No investable brand found</Text>
                      </View>
                      <Text style={styles.noMatchCopy}>
                        Try a tighter, brighter photo of a logo, label, or storefront.
                      </Text>
                      <View style={styles.noMatchActions}>
                        <Pressable
                          style={styles.dominantBtn}
                          onPress={refine}
                          accessibilityRole="button"
                          accessibilityLabel="Refine this photo by circling what you meant"
                        >
                          <Ionicons name="scan-outline" size={16} color={colors.accentInk} />
                          <Text style={styles.dominantBtnText}>Refine this photo</Text>
                        </Pressable>
                        <Pressable
                          style={styles.miniBtn}
                          onPress={retake}
                          accessibilityRole="button"
                          accessibilityLabel="Retake photo"
                        >
                          <Ionicons name="refresh" size={13} color={colors.accent} />
                          <Text style={styles.miniBtnText}>Retake</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                  {recovery ? (
                    <View
                      accessibilityRole="summary"
                      accessibilityLabel="Offline queue recovery required"
                    >
                      <View style={styles.noMatchHeading}>
                        <Ionicons name="shield-outline" size={18} color={colors.warn} />
                        <Text style={styles.resultTitle}>Offline queue needs attention</Text>
                      </View>
                      <Text style={styles.noMatchCopy}>
                        Queued photos are blocked and will not upload. {recovery.message}
                      </Text>
                      {recovery.quarantined ? (
                        <>
                          <Text style={styles.noMatchCopy}>
                            Discard removes these photos from the active queue. A private recovery
                            copy stays on this device for diagnostics.
                          </Text>
                          <Pressable
                            style={[
                              styles.dominantBtn,
                              resettingQueueRecovery && { opacity: 0.55 },
                            ]}
                            onPress={() => void discardUnrecoverableQueue()}
                            disabled={resettingQueueRecovery}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: resettingQueueRecovery }}
                            accessibilityLabel="Discard unreadable offline queue"
                          >
                            <Ionicons name="trash-outline" size={16} color={colors.accentInk} />
                            <Text style={styles.dominantBtnText}>
                              {resettingQueueRecovery
                                ? "Discarding offline queue…"
                                : "Discard offline queue"}
                            </Text>
                          </Pressable>
                        </>
                      ) : (
                        <Text style={styles.noMatchCopy}>
                          Restore device storage and reopen Camera before trying again. Nothing was
                          discarded.
                        </Text>
                      )}
                    </View>
                  ) : null}
                  {top ? (
                    <Pressable
                      style={styles.dominantBtn}
                      onPress={openPrimaryDetail}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${top.brand.name} details`}
                    >
                      <Text style={styles.dominantBtnText}>
                        {ticker ? `View $${ticker}` : "View investment options"}
                      </Text>
                      <Ionicons name="arrow-forward" size={16} color={colors.accentInk} />
                    </Pressable>
                  ) : null}
                  {additionalInvestables.length > 0 ? (
                    <View style={styles.additionalResults}>
                      <Text style={styles.additionalResultsLabel}>
                        Also found ({additionalInvestables.length})
                      </Text>
                      <View style={styles.additionalResultsList}>
                        {additionalInvestables.map((investable, index) => (
                          <Pressable
                            key={`${investable.brand.name}-${index}`}
                            style={styles.additionalResult}
                            onPress={() => openDetail(investable)}
                            accessibilityRole="button"
                            accessibilityLabel={`Open ${investable.brand.name}, ${investableLabel(investable)}`}
                          >
                            <View style={styles.additionalResultText}>
                              <Text style={styles.additionalResultTitle} numberOfLines={1}>
                                {investable.brand.name}
                              </Text>
                              <Text style={styles.additionalResultSubtitle} numberOfLines={1}>
                                {investableLabel(investable)}
                                {investable.brand.sector ? ` · ${investable.brand.sector}` : ""}
                              </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color={colors.fgMuted} />
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ) : null}
                  {top ? <EvidenceSection sources={top.sources} /> : null}
                  <View style={styles.cardActions}>
                    {ticker ? (
                      <Pressable
                        style={[styles.miniBtn, authSaveNavigationPending && { opacity: 0.55 }]}
                        onPress={() => void onSave()}
                        disabled={authSaveNavigationPending}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: authSaveNavigationPending }}
                        accessibilityLabel={`Save ${ticker} to watchlist`}
                      >
                        <Ionicons name="star-outline" size={13} color={colors.accent} />
                        <Text style={styles.miniBtnText}>Save</Text>
                      </Pressable>
                    ) : null}
                    {top ? (
                      <Pressable
                        style={styles.miniBtn}
                        onPress={openResearch}
                        accessibilityRole="button"
                        accessibilityLabel={`Research ${ticker ?? top.brand.name}`}
                      >
                        <Ionicons name="document-text-outline" size={13} color={colors.accent} />
                        <Text style={styles.miniBtnText}>Research</Text>
                      </Pressable>
                    ) : null}
                    {frozenUri ? (
                      <Pressable
                        style={styles.miniBtn}
                        onPress={refine}
                        accessibilityRole="button"
                        accessibilityLabel="Refine — circle what you meant"
                      >
                        <Ionicons name="scan-outline" size={13} color={colors.accent} />
                        <Text style={styles.miniBtnText}>Refine</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {top ? (
                    session?.token ? (
                      <Pressable
                        onPress={() => {
                          hapticSelect();
                          router.push("/universe");
                        }}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="View your finds"
                      >
                        <Text style={styles.findsNote}>Added to your finds · View</Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.findsNote}>Sign in to keep your finds.</Text>
                    )
                  ) : null}
                  {top && result && session?.token && user?.id ? (
                    <FindEvolutionNudge
                      session={session}
                      userId={user.id}
                      authGeneration={authGeneration}
                      ticker={top.brand.ticker?.symbol}
                      isPublic={top.brand.isPublic}
                      candidate={result}
                      quote={quote}
                    />
                  ) : null}
                  {savedNote ? <Text style={styles.queued}>{savedNote}</Text> : null}
                  {queuedNote ? <Text style={styles.queued}>{queuedNote}</Text> : null}
                  {err ? <Text style={styles.err}>{err}</Text> : null}
                </BlurView>
              </CardEntrance>
            </ScrollView>
          </View>
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

/** Subtle mount entrance for the result card — fade + rise, ~250ms. */
function CardEntrance({ children }: { children: ReactNode }) {
  const progress = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    progress.value = reduceMotion ? 1 : withTiming(1, { duration: 250 });
  }, [progress, reduceMotion]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }],
  }));

  return <Animated.View style={animStyle}>{children}</Animated.View>;
}

function IdentifyProgress({ stage }: { stage: IdentifyProgressStage }) {
  const copy = identifyProgressCopy(stage);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${copy.label}. ${copy.detail}`}
      accessibilityValue={{ min: 0, max: 3, now: copy.completedSteps }}
      accessibilityLiveRegion="polite"
      style={styles.identifyProgress}
    >
      <Text style={styles.identifyProgressTitle}>{copy.label}</Text>
      <Text style={styles.identifyProgressDetail}>{copy.detail}</Text>
      <View style={styles.identifySteps}>
        <IdentifyStep label="Photo" status={stage === "preparing" ? "active" : "done"} />
        <IdentifyStep label="Identify" status={stage === "identifying" ? "active" : "next"} />
        <IdentifyStep label="Match" status="next" />
      </View>
    </View>
  );
}

function IdentifyStep({ label, status }: { label: string; status: "active" | "done" | "next" }) {
  const isDone = status === "done";
  const isActive = status === "active";
  const reduceMotion = useReducedMotion();
  // Breathing pulse on the active dot — a static amber dot reads as "stuck"
  // even while the request is in flight. Same opacity loop as Skeleton.
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (isActive && !reduceMotion) {
      pulse.value = 0.35;
      pulse.value = withRepeat(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = 1;
    }
    return () => cancelAnimation(pulse);
  }, [isActive, reduceMotion, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [{ scale: 0.85 + pulse.value * 0.3 }],
  }));

  return (
    <View style={styles.identifyStep}>
      <Animated.View
        style={[
          styles.identifyStepDot,
          isActive && styles.identifyStepDotActive,
          isDone && styles.identifyStepDotDone,
          isActive ? pulseStyle : null,
        ]}
      >
        {isDone ? <Ionicons name="checkmark" size={10} color={colors.accentInk} /> : null}
      </Animated.View>
      <Text
        style={[styles.identifyStepLabel, status !== "next" && styles.identifyStepLabelCurrent]}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * One-line "what this means for you" under the brand. Never invents a
 * match: public brands missing a ticker get no line at all.
 */
function meaningLine(inv: Investable | undefined): string | null {
  if (!inv) return null;
  const symbol = inv.brand.ticker?.symbol;
  if (inv.brand.isPublic && symbol) {
    return `${inv.brand.name} is $${symbol.toUpperCase()} — you can own this.`;
  }
  if (inv.brand.isPublic) return null;
  const comp = inv.comparables?.[0]?.ticker;
  if (comp) {
    return `${inv.brand.name} is private — closest public cousin: $${comp.toUpperCase()}.`;
  }
  return `${inv.brand.name} looks private — no public match yet.`;
}

function confidenceLabel(c: Confidence | undefined): string {
  if (c === "high") return "High confidence";
  if (c === "low") return "Low confidence";
  return "Medium confidence";
}

/**
 * Map the categorical `Confidence` enum to a numeric [0,1] value — still
 * needed to drive the overlay's glow-opacity ramp. The user-facing pill
 * label uses the categorical word (`confidenceWord`), never a percent.
 */
function confidenceToNumber(c: Confidence | undefined): number {
  if (c === "high") return 0.9;
  if (c === "medium") return 0.65;
  if (c === "low") return 0.4;
  return 0.6;
}

/**
 * Coerce an identify response into overlay detections. Preserves any
 * server-provided detections (forward-compat) and otherwise synthesizes
 * a single centered detection from the top investable so the overlay
 * still has something to render.
 */
function coerceDetections(resp: IdentifyResponse | null): OverlayDetection[] {
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
      confidenceWord: inv.confidence,
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
  lessonRow: {
    alignItems: "center",
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
  identifyProgress: {
    width: "82%",
    maxWidth: 360,
    padding: 16,
    borderRadius: radii.lg,
    backgroundColor: colors.bgGlass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    gap: 6,
  },
  identifyProgressTitle: { color: colors.fg, ...type.label, fontSize: 15, fontWeight: "800" },
  identifyProgressDetail: { color: colors.fgMuted, ...type.caption, fontSize: 12 },
  identifySteps: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  identifyStep: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  identifyStepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.borderStrong,
  },
  identifyStepDotActive: { backgroundColor: colors.warn },
  identifyStepDotDone: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  identifyStepLabel: { color: colors.fgDim, ...type.caption, fontSize: 10 },
  identifyStepLabelCurrent: { color: colors.fg },
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
  resultRegion: { marginBottom: 8, flexShrink: 1 },
  resultScroll: { flexGrow: 0, flexShrink: 1 },
  resultScrollContent: { paddingBottom: 4 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  resultTitle: { color: colors.fg, ...type.h3, fontSize: 18, flexShrink: 1 },
  resultSubtitle: { color: colors.fgMuted, fontSize: 13, marginTop: 2 },
  noMatchHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  noMatchCopy: { color: colors.fgMuted, ...type.body, fontSize: 14, marginTop: 8 },
  noMatchActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  confidencePill: {
    backgroundColor: colors.bgGlass,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  confidencePillText: { color: colors.fgMuted, ...type.caption },
  meaning: { color: colors.fgMuted, fontSize: 14, lineHeight: 20, marginTop: 6 },
  priceLine: { color: colors.fg, fontSize: 14, fontWeight: "700", marginTop: 4 },
  dominantBtn: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dominantBtnText: { color: colors.accentInk, ...type.label, fontSize: 14, fontWeight: "800" },
  additionalResults: { gap: 6 },
  additionalResultsLabel: { color: colors.fgMuted, ...type.caption, fontSize: 12 },
  additionalResultsList: { gap: 6 },
  additionalResult: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: colors.bgGlass,
    borderColor: colors.glassBorder,
    borderWidth: 1,
  },
  additionalResultText: { flex: 1, minWidth: 0 },
  additionalResultTitle: { color: colors.fg, ...type.label, fontSize: 13 },
  additionalResultSubtitle: { color: colors.fgMuted, ...type.caption, fontSize: 11, marginTop: 1 },
  findsNote: { color: colors.fgDim, fontSize: 11, marginTop: 2 },
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
