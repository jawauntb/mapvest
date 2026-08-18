import type { PerformanceDataset } from "@/api/underlying";
import { StyleSheet, Text, View } from "react-native";
import { returnHeatColor, terminal } from "./palette";
import { ChartShell } from "./primitives";

/**
 * Monthly-return heatmap: 12 month rows (rotated so the requested month is
 * first) × 10 year columns plus Mean/Median 5Y, on the terminal's diverging
 * colormap with a symmetric ±max(5, |max|) domain.
 */
export function PerformanceHeatmap({ data }: { data: PerformanceDataset }) {
  const { columns, rows } = data.table;

  let maxAbs = 5;
  for (const row of rows) {
    for (const col of columns) {
      const v = row.values[col];
      if (v != null && Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    }
  }

  const headerLabel = (col: string) =>
    col === "Mean 5Y" ? "x̄5Y" : col === "Median 5Y" ? "M5Y" : `'${col.slice(2)}`;

  return (
    <ChartShell
      title={`${data.ticker} monthly return grid`}
      subtitle={`ROLLING 10 YEARS | ROTATED FROM ${data.meta.selected_month.toUpperCase()} | MEAN 5Y ${data.meta.mean_5y.toFixed(1)}%`}
      footerLeft={`${data.ticker} seasonality map`}
      footerRight={`source ${data.provider ?? "n/a"}`}
    >
      <View style={styles.grid}>
        <View style={styles.row}>
          <View style={styles.monthCell} />
          {columns.map((col) => (
            <View key={col} style={styles.cell}>
              <Text style={styles.headerText} numberOfLines={1}>
                {headerLabel(col)}
              </Text>
            </View>
          ))}
        </View>
        {rows.map((row) => (
          <View key={row.month} style={styles.row}>
            <View style={styles.monthCell}>
              <Text style={styles.monthText}>{row.month_label}</Text>
            </View>
            {columns.map((col) => {
              const v = row.values[col] ?? null;
              const t = v == null ? 0.5 : (v + maxAbs) / (2 * maxAbs);
              const bright = v != null && v > maxAbs * 0.34;
              return (
                <View key={col} style={[styles.cell, { backgroundColor: returnHeatColor(t) }]}>
                  {v != null ? (
                    <Text
                      style={[
                        styles.cellText,
                        { color: bright ? terminal.chartBg : terminal.text },
                      ]}
                      numberOfLines={1}
                    >
                      {v.toFixed(1)}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </View>
      <Text style={styles.scaleNote}>
        MONTHLY RETURN % · SCALE ±{maxAbs.toFixed(0)} · RED ↓ / GREEN ↑ / CYAN HOT
      </Text>
    </ChartShell>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 1.5 },
  row: { flexDirection: "row", gap: 1.5 },
  monthCell: { width: 26, height: 22, justifyContent: "center" },
  monthText: { color: terminal.muted, fontSize: 8.5, fontWeight: "700" },
  cell: {
    flex: 1,
    height: 22,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { color: terminal.muted, fontSize: 7, fontWeight: "700" },
  cellText: { fontSize: 7.5, fontWeight: "700" },
  scaleNote: { color: terminal.muted, fontSize: 8, letterSpacing: 0.3 },
});
