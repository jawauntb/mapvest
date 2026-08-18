import type { VolatilityDataset } from "@/api/underlying";
import { hapticSelect } from "@/util/haptics";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MONO_FONT, VOLATILITY_BAR_CYCLE, terminal } from "./palette";
import { ChartShell } from "./primitives";
import { fmtPct } from "./scale";

/**
 * Volatility radar: horizontal annualized-vol bars (pre-sorted descending)
 * with expected 1-week / 1-month dollar ranges, ~1.35× headroom.
 */
export function VolatilityChart({ data }: { data: VolatilityDataset }) {
  const [selected, setSelected] = useState<string | null>(null);
  const rows = data.rows;
  const maxVol = Math.max(0.0001, ...rows.map((r) => r.annual_vol));

  return (
    <ChartShell
      title="Historical volatility radar"
      subtitle="ANNUALIZED REALIZED VOLATILITY WITH EXPECTED RANGES"
      footerLeft="volatility scanner"
      footerRight={`${rows.length} symbols`}
    >
      <View style={styles.list}>
        {rows.map((row, idx) => {
          const color = VOLATILITY_BAR_CYCLE[idx % VOLATILITY_BAR_CYCLE.length];
          const frac = row.annual_vol / (maxVol * 1.35);
          return (
            <Pressable
              key={row.ticker}
              style={[styles.row, selected === row.ticker && styles.rowSelected]}
              onPress={() => {
                hapticSelect();
                setSelected(selected === row.ticker ? null : row.ticker);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: selected === row.ticker }}
              accessibilityLabel={`${row.ticker} volatility details`}
            >
              <Text style={styles.ticker}>{row.ticker}</Text>
              <View style={styles.trackColumn}>
                <View style={styles.track}>
                  <View style={[styles.bar, { width: `${frac * 100}%`, backgroundColor: color }]} />
                </View>
                <Text style={styles.rangeLabel} numberOfLines={1}>
                  {fmtPct(row.annual_vol)}
                  {"  |  1W ± "}
                  {row.one_week_range.toFixed(2)}
                  {"  |  1M ± "}
                  {row.one_month_range.toFixed(2)}
                </Text>
                {selected === row.ticker ? (
                  <Text style={[styles.rangeLabel, { color }]} numberOfLines={1}>
                    {"PX "}
                    {row.price.toFixed(2)}
                    {"  |  DAILY ±"}
                    {fmtPct(row.daily_vol)}
                    {"  |  ANNUAL "}
                    {fmtPct(row.annual_vol)}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </ChartShell>
  );
}

const styles = StyleSheet.create({
  list: {
    backgroundColor: terminal.axBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 201, 74, 0.34)",
    borderRadius: 6,
    padding: 10,
    gap: 10,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowSelected: { borderRadius: 4, backgroundColor: terminal.panel },
  ticker: {
    color: terminal.text,
    width: 52,
    fontSize: 10.5,
    fontWeight: "800",
    fontFamily: MONO_FONT,
  },
  trackColumn: { flex: 1, gap: 3 },
  track: {
    height: 12,
    borderRadius: 3,
    backgroundColor: terminal.panel,
    overflow: "hidden",
  },
  bar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 3,
    opacity: 0.86,
  },
  rangeLabel: {
    color: terminal.textStrong,
    fontSize: 8.5,
    fontWeight: "700",
    fontFamily: MONO_FONT,
  },
});
