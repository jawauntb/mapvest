import { useMemo } from "react";
import { View } from "react-native";
import { pointsAttr, sparklinePoints } from "./draw";
import { Circle, Polygon, Polyline } from "./view-svg";

/**
 * Connected close-to-close line with a light area fill. Uses View primitives
 * (not react-native-svg) so it stays stable on current Xcode / iOS.
 */
export function LineSparkline({
  series,
  width,
  height,
  color,
  strokeWidth = 2,
  pad = 6,
  fill = true,
  endDot = true,
}: {
  series: number[];
  width: number;
  height: number;
  color: string;
  strokeWidth?: number;
  pad?: number;
  fill?: boolean;
  endDot?: boolean;
}) {
  const pts = useMemo(
    () => sparklinePoints(series, width, height, pad),
    [series, width, height, pad],
  );
  const last = pts[pts.length - 1];
  const first = pts[0];
  if (pts.length < 2 || !last || !first) return null;

  const line = pointsAttr(pts);
  const area = `${line} ${last.x.toFixed(1)},${height - 1} ${first.x.toFixed(1)},${height - 1}`;

  return (
    <View style={{ width, height }} pointerEvents="none">
      {fill ? <Polygon points={area} fill={color} opacity={0.16} /> : null}
      <Polyline points={line} fill="none" stroke={color} strokeWidth={strokeWidth} />
      {endDot ? <Circle cx={last.x} cy={last.y} r={3.4} fill={color} /> : null}
    </View>
  );
}
