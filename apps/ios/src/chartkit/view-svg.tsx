/**
 * SVG-shaped primitives implemented with plain React Native Views.
 *
 * react-native-svg native-crashes (SIGABRT) and flashes a blank CALayer on
 * current Xcode / iOS builds — empty/NaN `points`, Fabric/source-built RN
 * ABI drift. These Views use the same props the terminal charts already pass,
 * so chart files keep their layout math.
 */
import type { ReactNode } from "react";
import { Text as RNText, type TextStyle, View } from "react-native";
import {
  type SegmentFrame,
  lineFrames,
  normalizeRect,
  parsePoints,
  polygonFillStrips,
} from "./draw";

type LineProps = {
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string | number;
  opacity?: number;
};

type RectProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  rx?: number;
};

type CircleProps = {
  cx?: number;
  cy?: number;
  r?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
};

type PolyPoints = {
  points?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
};

type TextProps = {
  x?: number;
  y?: number;
  fill?: string;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
  textAnchor?: "start" | "middle" | "end";
  opacity?: number;
  children?: ReactNode;
};

function StrokeViews({
  frames,
  color,
  opacity,
}: {
  frames: SegmentFrame[];
  color: string;
  opacity?: number;
}) {
  return (
    <>
      {frames.map((f, i) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: segment index is the identity
          key={i}
          pointerEvents="none"
          style={{
            position: "absolute",
            left: f.left,
            top: f.top,
            width: f.width,
            height: f.height,
            backgroundColor: color,
            opacity,
            borderRadius: Math.min(f.height / 2, 2),
            transform: [{ rotate: `${f.rotateDeg}deg` }],
          }}
        />
      ))}
    </>
  );
}

export function Svg({
  width,
  height,
  children,
  pointerEvents = "none",
}: {
  width: number;
  height: number;
  children?: ReactNode;
  pointerEvents?: "none" | "auto" | "box-none";
}) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return null;
  }
  return (
    <View pointerEvents={pointerEvents} style={{ width, height, overflow: "hidden" }}>
      {children}
    </View>
  );
}

export function G({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function Line({
  x1,
  y1,
  x2,
  y2,
  stroke = "#ffffff",
  strokeWidth = 1,
  strokeDasharray,
  opacity,
}: LineProps) {
  const a = { x: Number(x1), y: Number(y1) };
  const b = { x: Number(x2), y: Number(y2) };
  if (![a.x, a.y, b.x, b.y, strokeWidth].every(Number.isFinite)) return null;
  const frames = lineFrames(a, b, strokeWidth, strokeDasharray);
  if (frames.length === 0) return null;
  return <StrokeViews frames={frames} color={stroke} opacity={opacity} />;
}

export function Rect({ x, y, width, height, fill, stroke, strokeWidth, opacity, rx }: RectProps) {
  const box = normalizeRect(Number(x), Number(y), Number(width), Number(height));
  if (!box) return null;
  const hasFill = !!fill && fill !== "none";
  const border = stroke && strokeWidth ? strokeWidth : 0;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        backgroundColor: hasFill ? fill : "transparent",
        borderRadius: rx ?? 0,
        borderWidth: border,
        borderColor: stroke,
        opacity,
      }}
    />
  );
}

export function Circle({ cx, cy, r, fill, stroke, strokeWidth, opacity }: CircleProps) {
  const nx = Number(cx);
  const ny = Number(cy);
  const nr = Number(r);
  if (![nx, ny, nr].every(Number.isFinite) || nr <= 0) return null;
  const border = stroke && strokeWidth ? strokeWidth : 0;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: nx - nr,
        top: ny - nr,
        width: nr * 2,
        height: nr * 2,
        borderRadius: nr,
        backgroundColor: fill && fill !== "none" ? fill : "transparent",
        borderWidth: border,
        borderColor: stroke,
        opacity,
      }}
    />
  );
}

export function Polygon({ points, fill, stroke, strokeWidth = 0.8, opacity }: PolyPoints) {
  const pts = parsePoints(points);
  if (pts.length < 3) return null;
  const hasFill = !!fill && fill !== "none";
  const hasStroke = !!stroke && stroke !== "none";
  const strips = hasFill ? polygonFillStrips(pts) : [];
  return (
    <>
      {strips.map((s, i) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: strip index is the identity
          key={`f-${i}`}
          pointerEvents="none"
          style={{
            position: "absolute",
            left: s.x,
            top: s.y,
            width: s.width,
            height: s.height,
            backgroundColor: fill,
            opacity,
          }}
        />
      ))}
      {hasStroke
        ? pts.map((a, i) => {
            const b = pts[(i + 1) % pts.length];
            if (!b) return null;
            return (
              <Line
                key={`e-${a.x}-${a.y}-${b.x}-${b.y}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={stroke}
                strokeWidth={strokeWidth}
                opacity={opacity}
              />
            );
          })
        : null}
    </>
  );
}

export function Polyline({
  points,
  fill,
  stroke,
  strokeWidth = 1,
  strokeDasharray,
  opacity,
}: PolyPoints & {
  strokeDasharray?: string | number;
}) {
  const pts = parsePoints(points);
  if (pts.length < 2) return null;
  const hasFill = !!fill && fill !== "none";
  const hasStroke = !!stroke && stroke !== "none";
  return (
    <>
      {hasFill ? <Polygon points={points} fill={fill} opacity={opacity} /> : null}
      {hasStroke
        ? pts.slice(0, -1).map((a, i) => {
            const b = pts[i + 1];
            if (!b) return null;
            return (
              <Line
                key={`s-${a.x}-${a.y}-${b.x}-${b.y}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDasharray}
                opacity={opacity}
              />
            );
          })
        : null}
    </>
  );
}

export function Text({
  x,
  y,
  fill = "#ffffff",
  fontSize = 10,
  fontWeight,
  fontFamily,
  textAnchor = "start",
  opacity,
  children,
}: TextProps) {
  const nx = Number(x);
  const ny = Number(y);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  const fs = fontSize;
  const boxW = 220;
  let left = nx;
  let align: TextStyle["textAlign"] = "left";
  if (textAnchor === "middle") {
    left = nx - boxW / 2;
    align = "center";
  } else if (textAnchor === "end") {
    left = nx - boxW;
    align = "right";
  }
  const weight: TextStyle["fontWeight"] = fontWeight === "bold" ? "700" : "600";
  return (
    <RNText
      pointerEvents="none"
      numberOfLines={1}
      style={{
        position: "absolute",
        left,
        top: ny - fs * 0.85,
        width: boxW,
        color: fill,
        fontSize: fs,
        fontWeight: weight,
        fontFamily,
        textAlign: align,
        opacity,
      }}
    >
      {children}
    </RNText>
  );
}

export type PolylineProps = PolyPoints & { strokeDasharray?: string | number };
export type PolygonProps = PolyPoints;
