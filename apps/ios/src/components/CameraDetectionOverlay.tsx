import type { Confidence, Detection } from "@/api/types";
import { colors, radii } from "@/theme/tokens";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

const ACCENT = colors.accent;
// Parsed once so the layered glow Views can reuse the RGB channels.
const ACCENT_RGB = { r: 0x14, g: 0xc4, b: 0xa6 };

const MAX_DETECTIONS = 3;
const PILL_HEIGHT = 22;
const PILL_GAP = 4;

/**
 * Detection plus the categorical confidence from the identify response.
 * Numeric `confidence` still drives glow intensity; the pill label shows
 * the honest categorical level, never a synthesized percent.
 */
export type OverlayDetection = Detection & { confidenceWord?: Confidence };

type Props = {
  detections: OverlayDetection[];
  containerSize: { width: number; height: number };
};

type PositionedPill = {
  x: number;
  y: number;
  width: number;
};

type LaidOutDetection = OverlayDetection & {
  // absolute pixel rect within the container
  px: { left: number; top: number; width: number; height: number };
  glowOpacity: number;
  topPill: PositionedPill;
  bottomPill: PositionedPill;
  labelText: string;
  bottomText?: string;
};

/**
 * Overlay drawn atop the frozen camera frame. Renders up to 3 glowing
 * bounding boxes with a top ticker/confidence pill and an optional bottom
 * brand-name pill. Boxes are absolutely positioned inside a single flat
 * View — no per-box images, no nested lists.
 *
 * A subtle 2s "breath" animation was considered per spec; the static glow
 * proved plenty on real devices and keeps the GPU fully idle between frames.
 */
export function CameraDetectionOverlay({ detections, containerSize }: Props) {
  const laidOut = useMemo(
    () => layoutDetections(detections, containerSize),
    [detections, containerSize],
  );

  if (!laidOut.length) return null;

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFillObject}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {laidOut.map((det, i) => (
        <DetectionCell key={`${det.ticker}-${i}`} det={det} />
      ))}
    </View>
  );
}

function DetectionCell({ det }: { det: LaidOutDetection }) {
  const { px, glowOpacity, topPill, bottomPill, labelText, bottomText } = det;

  return (
    <>
      {/* Outer soft glow — layered semi-transparent shapes faked without expo-blur. */}
      <View
        style={{
          position: "absolute",
          left: px.left - 14,
          top: px.top - 14,
          width: px.width + 28,
          height: px.height + 28,
          borderRadius: radii.lg,
          backgroundColor: rgba(ACCENT_RGB, glowOpacity * 0.08),
          shadowColor: ACCENT,
          shadowOpacity: glowOpacity * 0.9,
          shadowRadius: 22,
          shadowOffset: { width: 0, height: 0 },
        }}
      />
      <View
        style={{
          position: "absolute",
          left: px.left - 6,
          top: px.top - 6,
          width: px.width + 12,
          height: px.height + 12,
          borderRadius: radii.md,
          borderColor: rgba(ACCENT_RGB, glowOpacity * 0.35),
          borderWidth: 1,
        }}
      />

      {/* The bounding box itself. */}
      <View
        style={{
          position: "absolute",
          left: px.left,
          top: px.top,
          width: px.width,
          height: px.height,
          borderRadius: radii.sm,
          borderColor: rgba(ACCENT_RGB, Math.min(1, glowOpacity + 0.15)),
          borderWidth: 2,
          backgroundColor: rgba(ACCENT_RGB, glowOpacity * 0.06),
        }}
      />

      {/* Top pill — ticker + confidence level */}
      <View
        style={[
          styles.topPill,
          {
            left: topPill.x,
            top: topPill.y,
            backgroundColor: rgba(ACCENT_RGB, Math.min(0.95, glowOpacity * 0.9 + 0.2)),
          },
        ]}
      >
        <Text style={styles.topPillText} numberOfLines={1}>
          {labelText}
        </Text>
      </View>

      {/* Bottom pill — brand name (muted) */}
      {bottomText ? (
        <View
          style={[
            styles.bottomPill,
            {
              left: bottomPill.x,
              top: bottomPill.y,
            },
          ]}
        >
          <Text style={styles.bottomPillText} numberOfLines={1}>
            {bottomText}
          </Text>
        </View>
      ) : null}
    </>
  );
}

function rgba({ r, g, b }: { r: number; g: number; b: number }, a: number): string {
  const clamped = Math.max(0, Math.min(1, a));
  return `rgba(${r}, ${g}, ${b}, ${clamped.toFixed(3)})`;
}

/**
 * Turn normalized detection boxes into absolute-positioned rects, resolve
 * pill positions, and offset any pills that would collide. Boxes are only
 * shrunk (never grown) when two physically overlap in image space, with a
 * cap so the target isn't cut off.
 */
export function layoutDetections(
  detections: OverlayDetection[],
  containerSize: { width: number; height: number },
): LaidOutDetection[] {
  const { width: W, height: H } = containerSize;
  if (!detections.length || W <= 0 || H <= 0) return [];

  const trimmed = detections.slice(0, MAX_DETECTIONS);

  // 1. Project each normalized box into pixel space.
  const rects = trimmed.map((d) => {
    const left = clamp(d.box.x * W, 0, W);
    const top = clamp(d.box.y * H, 0, H);
    const width = clamp(d.box.w * W, 24, W - left);
    const height = clamp(d.box.h * H, 24, H - top);
    return { left, top, width, height };
  });

  // 2. If two boxes physically overlap in image space, shrink the smaller
  //    one by up to 12% so the operator can still tell them apart. Cap the
  //    shrink so we never crop below 60% of the original span.
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const rectI = rects[i];
      const rectJ = rects[j];
      if (!rectI || !rectJ) continue;
      if (rectsOverlap(rectI, rectJ)) {
        const target = area(rectI) <= area(rectJ) ? rectI : rectJ;
        const shrink = Math.min(0.12, 1 - 0.6);
        target.width *= 1 - shrink;
        target.height *= 1 - shrink;
      }
    }
  }

  // 3. Compute pill candidates. Top pill sits above the box; bottom below.
  const pillOf = (rect: { left: number; top: number; width: number; height: number }) => ({
    top: {
      x: clamp(rect.left, 4, W - 4),
      y: clamp(rect.top - PILL_HEIGHT - PILL_GAP, 4, H - PILL_HEIGHT - 4),
      width: Math.min(rect.width, W - 8),
    },
    bottom: {
      x: clamp(rect.left, 4, W - 4),
      y: clamp(rect.top + rect.height + PILL_GAP, 4, H - PILL_HEIGHT - 4),
      width: Math.min(rect.width, W - 8),
    },
  });

  const withPills = rects.map((r) => pillOf(r));

  // 4. Offset overlapping top pills. Sort ascending by top-Y, and if the
  //    current pill would collide with any earlier pill's stripe, push it
  //    down by pill-height + gap. Keep it inside the container.
  const sortedTopIdx = [...withPills.keys()].sort(
    (a, b) => (withPills[a]?.top.y ?? 0) - (withPills[b]?.top.y ?? 0),
  );
  for (let i = 1; i < sortedTopIdx.length; i++) {
    const currIdx = sortedTopIdx[i];
    if (currIdx === undefined) continue;
    const curr = withPills[currIdx];
    if (!curr) continue;
    for (let j = 0; j < i; j++) {
      const prevIdx = sortedTopIdx[j];
      if (prevIdx === undefined) continue;
      const prev = withPills[prevIdx];
      if (!prev) continue;
      if (pillsCollide(prev.top, curr.top)) {
        curr.top.y = Math.min(prev.top.y + PILL_HEIGHT + PILL_GAP, H - PILL_HEIGHT - 4);
      }
    }
  }

  // 5. Same for bottom pills, but from the bottom up (push up on collision).
  const sortedBottomIdx = [...withPills.keys()].sort(
    (a, b) => (withPills[b]?.bottom.y ?? 0) - (withPills[a]?.bottom.y ?? 0),
  );
  for (let i = 1; i < sortedBottomIdx.length; i++) {
    const currIdx = sortedBottomIdx[i];
    if (currIdx === undefined) continue;
    const curr = withPills[currIdx];
    if (!curr) continue;
    for (let j = 0; j < i; j++) {
      const prevIdx = sortedBottomIdx[j];
      if (prevIdx === undefined) continue;
      const prev = withPills[prevIdx];
      if (!prev) continue;
      if (pillsCollide(prev.bottom, curr.bottom)) {
        curr.bottom.y = Math.max(prev.bottom.y - PILL_HEIGHT - PILL_GAP, 4);
      }
    }
  }

  // 6. Compose final laid-out records.
  const out: LaidOutDetection[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    const det = trimmed[i];
    const px = rects[i];
    const pills = withPills[i];
    if (!det || !px || !pills) continue;
    const confidence = clamp(det.confidence, 0, 1);
    const glowOpacity = 0.35 + 0.65 * confidence;
    out.push({
      ...det,
      px,
      glowOpacity,
      topPill: pills.top,
      bottomPill: pills.bottom,
      labelText: `${det.ticker.toUpperCase()} · ${confidenceWordFor(det)}`,
      bottomText: det.name,
    });
  }
  return out;
}

const CONFIDENCE_WORDS: Record<Confidence, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * Categorical label for the pill. Server-provided detections (forward-compat
 * path) only carry the numeric confidence, so bucket it instead of showing
 * a percent that implies precision we don't have.
 */
function confidenceWordFor(det: OverlayDetection): string {
  if (det.confidenceWord) return CONFIDENCE_WORDS[det.confidenceWord];
  if (det.confidence >= 0.8) return "High";
  if (det.confidence >= 0.5) return "Medium";
  return "Low";
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function area(r: { width: number; height: number }) {
  return r.width * r.height;
}

function rectsOverlap(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
) {
  return !(
    a.left + a.width <= b.left ||
    b.left + b.width <= a.left ||
    a.top + a.height <= b.top ||
    b.top + b.height <= a.top
  );
}

function pillsCollide(a: PositionedPill, b: PositionedPill) {
  const aRight = a.x + a.width;
  const bRight = b.x + b.width;
  const horizOverlap = !(aRight <= b.x || bRight <= a.x);
  const vertOverlap = Math.abs(a.y - b.y) < PILL_HEIGHT + PILL_GAP;
  return horizOverlap && vertOverlap;
}

const styles = StyleSheet.create({
  topPill: {
    position: "absolute",
    height: PILL_HEIGHT,
    paddingHorizontal: 8,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: ACCENT,
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  topPillText: {
    color: colors.accentInk,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  bottomPill: {
    position: "absolute",
    height: PILL_HEIGHT - 4,
    paddingHorizontal: 8,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12, 14, 16, 0.72)",
    borderColor: colors.glassBorder,
    borderWidth: 1,
  },
  bottomPillText: {
    color: colors.fgMuted,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});
