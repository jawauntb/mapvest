import type { PrismMacroSeries, PrismPacket } from "@/api/prism";
import { YieldCurveMini } from "@/chartkit/prism";
import { colors, space, type } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import {
  fmtCount,
  fmtMoneyCompact,
  fmtNumber,
  fmtPoints,
  fmtSignedPct,
  humanize,
  sectionUnavailable,
} from "./format";
import { type MacroTile, macroTiles, yieldCurvePoints } from "./signals";
import { SectionCard, StatTile, toneFg } from "./ui";

function tileValue(tile: MacroTile): string {
  const current = tile.series.current;
  switch (tile.unit) {
    case "price":
      return fmtMoneyCompact(current);
    case "thousands":
      return typeof current === "number" ? fmtCount(current) : "—";
    case "index":
      return fmtNumber(current, 1);
    default:
      return fmtNumber(current, 2);
  }
}

/**
 * The macro frame the ticker is trading inside: the Treasury curve, then the
 * six series that move risk appetite.
 *
 * Each tile colours its 1-month change by whether that direction is risk-on for
 * that series — a falling VIX and a rising gold price are not the same sign of
 * the same thing, so a single "green is up" rule would mislead.
 */
export function MacroSection({ packet }: { packet: PrismPacket }) {
  const macro = packet.macro;
  const unavailable = sectionUnavailable(packet, "macro", macro);
  const curve = yieldCurvePoints(macro);
  const tiles = macroTiles(macro);
  const shape = macro?.curve_shape ?? null;

  const changeTone = (tile: MacroTile) => {
    const change = tile.series.change_1m;
    if (typeof change !== "number" || !Number.isFinite(change) || change === 0) return "neutral";
    const rising = change > 0;
    return (tile.bullish === "up") === rising ? "bull" : "bear";
  };

  return (
    <SectionCard
      eyebrow="Macro"
      title="The frame"
      subtitle={
        shape?.label
          ? `Curve: ${humanize(shape.label)} · 2s10s ${fmtPoints(shape["2s10s"], 2)}`
          : "Treasury curve, volatility, credit, dollar, energy, and labor."
      }
      unavailable={unavailable}
    >
      {curve.length >= 2 ? (
        <YieldCurveMini points={curve} />
      ) : (
        <Text style={styles.note}>Treasury curve unavailable: fewer than two tenors returned.</Text>
      )}

      {tiles.length > 0 ? (
        <View style={styles.tileGrid}>
          {tiles.map((tile) => (
            <StatTile
              key={tile.key}
              label={tile.label}
              value={tileValue(tile)}
              sub={changeSub(tile.series)}
              tone={changeTone(tile)}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.note}>No macro series were returned for this packet.</Text>
      )}

      {tiles.length > 0 ? (
        <Text style={styles.legend}>
          Change is one month. Colour is risk appetite, not direction:{" "}
          <Text style={{ color: toneFg("bull") }}>jade</Text> is the risk-on move for that series.
        </Text>
      ) : null}
    </SectionCard>
  );
}

function changeSub(series: PrismMacroSeries): string | undefined {
  const change = series.change_1m;
  if (typeof change !== "number" || !Number.isFinite(change)) return undefined;
  return `${fmtSignedPct(change)} 1m`;
}

const styles = StyleSheet.create({
  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  note: { color: colors.fgMuted, fontSize: 12, fontStyle: "italic", lineHeight: 17 },
  legend: { color: colors.fgMuted, fontSize: 11, lineHeight: 16 },
});
