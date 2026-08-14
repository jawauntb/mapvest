import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect, hapticTap } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Region of Interest expressed in normalized IMAGE coordinates (0..1) —
 * NOT container / preview coordinates. Server (or future model) can
 * translate (xN, yN, rN) into pixel space regardless of how the client
 * chose to preview the image (aspect fit / contain / cover).
 */
export type NormalizedRoi = { xN: number; yN: number; rN: number };

export type PhotoAnnotatorProps = {
  imageUri: string;
  onCancel: () => void;
  onConfirm: (opts: {
    imageUri: string;
    roi?: NormalizedRoi;
    hint?: string;
  }) => void;
};

type ImageRect = { x: number; y: number; width: number; height: number };

/**
 * Full-bleed image with a tap-to-place, drag-to-size circle overlay and an
 * optional single-line text hint. Emits normalized-image-space coordinates
 * on confirm so the server can interpret ROI without knowing preview dims.
 *
 * Interaction: press → circle appears at finger with r=0; drag outward →
 * radius grows to the distance from center; release → circle sticks until
 * user taps again (which resets center + radius) or hits "Clear circle".
 *
 * Gestures use `react-native-gesture-handler`'s `Gesture.Pan` because it
 * runs on the UI thread and gives us instant-feedback drawing without
 * setState-per-frame overhead.
 */
export function PhotoAnnotator({ imageUri, onCancel, onConfirm }: PhotoAnnotatorProps) {
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [hint, setHint] = useState("");
  // Committed circle (post-release). Kept in CONTAINER-space coordinates
  // (pt values inside the layout box); we convert to normalized image
  // coords only on Scan.
  const [committed, setCommitted] = useState<{
    cx: number;
    cy: number;
    r: number;
  } | null>(null);

  // Live drag values, driven on the UI thread so the circle tracks the
  // finger without any bridge latency. `active` toggles overlay visibility
  // between "committed circle" and "live drag circle".
  const active = useSharedValue(0);
  const cx = useSharedValue(0);
  const cy = useSharedValue(0);
  const r = useSharedValue(0);

  // Load the underlying image's natural size once — needed to compute the
  // actual rendered rect inside a "contain" fit so we can translate
  // container-space circle to image-space normalized ROI.
  useEffect(() => {
    let cancelled = false;
    Image.getSize(
      imageUri,
      (w, h) => {
        if (!cancelled) setNaturalSize({ width: w, height: h });
      },
      () => {
        if (!cancelled) setNaturalSize(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [imageUri]);

  function onImageLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  }

  // The rendered image rect inside the container (letterbox-aware). If we
  // don't know the natural size yet we fall back to the full container so
  // the overlay still tracks the finger — worst case the ROI is normalized
  // against the container until the size load completes (which is typically
  // a tick).
  const imageRect = useMemo<ImageRect>(() => {
    if (containerSize.width === 0 || containerSize.height === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    if (!naturalSize || naturalSize.width === 0 || naturalSize.height === 0) {
      return { x: 0, y: 0, width: containerSize.width, height: containerSize.height };
    }
    const containerAspect = containerSize.width / containerSize.height;
    const imageAspect = naturalSize.width / naturalSize.height;
    if (imageAspect > containerAspect) {
      // Wider than container: bars on top/bottom.
      const width = containerSize.width;
      const height = width / imageAspect;
      return {
        x: 0,
        y: (containerSize.height - height) / 2,
        width,
        height,
      };
    }
    // Taller than container: bars on left/right.
    const height = containerSize.height;
    const width = height * imageAspect;
    return {
      x: (containerSize.width - width) / 2,
      y: 0,
      width,
      height,
    };
  }, [containerSize, naturalSize]);

  // Commit the released circle from the UI thread back into React state,
  // and clear the "active drag" flag so the overlay switches from the
  // live-tracking style to the settled style.
  function commitRelease(nextCx: number, nextCy: number, nextR: number) {
    if (nextR < 4) {
      // Treat tap-with-no-drag as "clear" — feels natural.
      setCommitted(null);
      return;
    }
    setCommitted({ cx: nextCx, cy: nextCy, r: nextR });
  }

  function beginDrag() {
    // Fires only when a NEW touch starts. Reset any committed circle so
    // there's never a moment where two circles are visible.
    setCommitted(null);
    hapticTap();
  }

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0) // fire on immediate touch, not after a threshold
        .maxPointers(1)
        .onBegin((e) => {
          "worklet";
          active.value = 1;
          cx.value = e.x;
          cy.value = e.y;
          r.value = 0;
          runOnJS(beginDrag)();
        })
        .onUpdate((e) => {
          "worklet";
          const dx = e.x - cx.value;
          const dy = e.y - cy.value;
          r.value = Math.sqrt(dx * dx + dy * dy);
        })
        .onEnd(() => {
          "worklet";
          active.value = 0;
          runOnJS(commitRelease)(cx.value, cy.value, r.value);
        })
        .onFinalize(() => {
          "worklet";
          active.value = 0;
        }),
    // The shared values / worklet-called JS fns are stable-refs, so an
    // empty deps array is safe and keeps the gesture instance stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Overlay for the LIVE drag — updates on UI thread. Rendered with
  // pointerEvents="none" so it never intercepts the gesture.
  const liveStyle = useAnimatedStyle(() => {
    const size = Math.max(0, r.value) * 2;
    return {
      opacity: active.value,
      width: size,
      height: size,
      borderRadius: Math.max(0, r.value),
      transform: [{ translateX: cx.value - r.value }, { translateY: cy.value - r.value }],
    };
  });

  function clearCircle() {
    hapticSelect();
    setCommitted(null);
    active.value = 0;
    r.value = 0;
  }

  function normalizeToImage(circle: {
    cx: number;
    cy: number;
    r: number;
  }): NormalizedRoi | undefined {
    if (imageRect.width <= 0 || imageRect.height <= 0) return undefined;
    const xInImg = circle.cx - imageRect.x;
    const yInImg = circle.cy - imageRect.y;
    const xN = xInImg / imageRect.width;
    const yN = yInImg / imageRect.height;
    // Normalize the radius against the SHORTER image side. Server can
    // reconstruct absolute radius as rN * min(imageWidth, imageHeight).
    const shorter = Math.min(imageRect.width, imageRect.height);
    const rN = circle.r / shorter;
    // Reject clearly-off-image ROIs (all letterbox bar taps) — fall back to
    // no ROI rather than shipping nonsense coords.
    if (xN < 0 || xN > 1 || yN < 0 || yN > 1) return undefined;
    return {
      xN: clamp01(xN),
      yN: clamp01(yN),
      rN: Math.max(0.005, Math.min(1, rN)),
    };
  }

  function onScan() {
    const roi = committed ? normalizeToImage(committed) : undefined;
    const trimmed = hint.trim();
    onConfirm({
      imageUri,
      roi,
      hint: trimmed.length > 0 ? trimmed : undefined,
    });
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Pressable
            hitSlop={8}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={styles.headerBtn}
          >
            <Ionicons name="close" size={22} color={colors.fg} />
          </Pressable>
          <Text style={styles.headerTitle}>Circle what you meant</Text>
          <View style={styles.headerBtn} />
        </View>

        <GestureDetector gesture={pan}>
          <View style={styles.imageWrap} onLayout={onImageLayout} collapsable={false}>
            <Image
              source={{ uri: imageUri }}
              style={StyleSheet.absoluteFillObject}
              resizeMode="contain"
            />
            {/* Committed circle — settled state, snaps into place on release. */}
            {committed ? (
              <View
                pointerEvents="none"
                style={[
                  styles.circle,
                  styles.circleCommitted,
                  {
                    width: committed.r * 2,
                    height: committed.r * 2,
                    borderRadius: committed.r,
                    left: committed.cx - committed.r,
                    top: committed.cy - committed.r,
                  },
                ]}
              />
            ) : null}
            {/* Live-drag circle — runs on UI thread via Reanimated. */}
            <Animated.View
              pointerEvents="none"
              style={[styles.circle, styles.circleLive, liveStyle]}
            />
            {!committed ? (
              <View pointerEvents="none" style={styles.hintOverlay}>
                <Text style={styles.hintOverlayText}>
                  Tap the object and drag outward to draw a circle
                </Text>
              </View>
            ) : null}
          </View>
        </GestureDetector>

        {committed ? (
          <Pressable
            onPress={clearCircle}
            accessibilityRole="button"
            accessibilityLabel="Clear circle"
            style={styles.clearBtn}
          >
            <Ionicons name="close-circle-outline" size={14} color={colors.fgMuted} />
            <Text style={styles.clearBtnText}>Clear circle</Text>
          </Pressable>
        ) : null}

        <View style={styles.hintRow}>
          <TextInput
            value={hint}
            onChangeText={setHint}
            placeholder="Add a note (optional) — 'the Chase branch', 'blue can'…"
            placeholderTextColor={colors.fgDim}
            style={styles.hintInput}
            maxLength={140}
            returnKeyType="done"
            selectionColor={colors.accent}
          />
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={[styles.actionBtn, styles.cancelBtn]}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={onScan}
            accessibilityRole="button"
            accessibilityLabel="Scan"
            style={[styles.actionBtn, styles.scanBtn]}
          >
            <Ionicons name="scan-outline" size={16} color={colors.accentInk} />
            <Text style={styles.scanBtnText}>Scan</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#000",
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  headerTitle: { color: colors.fg, ...type.label, fontSize: 14 },
  imageWrap: {
    flex: 1,
    backgroundColor: "#000",
    overflow: "hidden",
  },
  circle: {
    position: "absolute",
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: "rgba(20, 196, 166, 0.18)",
  },
  circleLive: {
    // Slightly warmer fill mid-drag so the user can distinguish "drawing"
    // from "drawn" without doubling the border thickness.
    backgroundColor: "rgba(20, 196, 166, 0.28)",
  },
  circleCommitted: {
    // Committed state settles to the standard accent stroke.
  },
  hintOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 12,
    alignItems: "center",
  },
  hintOverlayText: {
    color: colors.fg,
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: "rgba(0,0,0,0.5)",
    overflow: "hidden",
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
  },
  clearBtnText: { color: colors.fgMuted, fontSize: 13, fontWeight: "600" },
  hintRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: "#000",
  },
  hintInput: {
    color: colors.fg,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radii.md,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: "#000",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flex: 1,
    paddingVertical: 14,
    borderRadius: radii.lg,
    minHeight: 48,
  },
  cancelBtn: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: { color: colors.fg, fontSize: 15, fontWeight: "700" },
  scanBtn: {
    backgroundColor: colors.accent,
  },
  scanBtnText: { color: colors.accentInk, fontSize: 15, fontWeight: "800" },
});
