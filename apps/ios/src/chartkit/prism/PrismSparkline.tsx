import type { Tone } from "@/prism/format";
import { pointsAttr, sparklinePoints } from "../draw";
import { SafePolygon, SafePolyline } from "../primitives";
import { Circle } from "../view-svg";
import { PrismPanel } from "./PrismPanel";
import { chart, toneColor, toneSoft } from "./theme";

/**
 * Tiny trend line for a fundamentals series (revenue, margin, FCF…). Eight
 * quarters is the usual input, so this stays a shape — the numbers next to it
 * carry the values.
 */
export function PrismSparkline({
  values,
  height = 40,
  tone,
  filled = true,
}: {
  values: number[];
  height?: number;
  tone?: Tone;
  filled?: boolean;
}) {
  const first = values[0];
  const last = values[values.length - 1];
  const resolvedTone: Tone =
    tone ??
    (first === undefined || last === undefined
      ? "neutral"
      : last > first
        ? "bull"
        : last < first
          ? "bear"
          : "neutral");
  const color = toneColor(resolvedTone);

  return (
    <PrismPanel height={height}>
      {(w, h) => {
        if (values.length < 2) return null;
        const pts = sparklinePoints(values, w, h, 6);
        const tail = pts[pts.length - 1];
        return (
          <>
            {filled && pts.length > 1 ? (
              <SafePolygon
                points={pointsAttr([
                  ...pts,
                  { x: pts[pts.length - 1]?.x ?? 0, y: h },
                  { x: pts[0]?.x ?? 0, y: h },
                ])}
                fill={toneSoft(resolvedTone)}
              />
            ) : null}
            <SafePolyline points={pointsAttr(pts)} fill="none" stroke={color} strokeWidth={1.8} />
            {tail ? (
              <Circle
                cx={tail.x}
                cy={tail.y}
                r={2.6}
                fill={color}
                stroke={chart.bg}
                strokeWidth={1}
              />
            ) : null}
          </>
        );
      }}
    </PrismPanel>
  );
}
