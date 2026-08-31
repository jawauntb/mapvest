import type { PerformanceDataset } from "@/api/underlying";
import { providerName } from "@/evidence/presentation";
import { hapticSelect } from "@/util/haptics";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { safeFixed, safeUpper } from "./format";
import { MONO_FONT, returnHeatColor, terminal } from "./palette";
import { ChartShell, PanelNote } from "./primitives";

/**
 * Monthly-return heatmap: 12 month rows (rotated so the requested month is
 * first) × 10 year columns plus Mean/Median 5Y, on the terminal's diverging
 * colormap with a symmetric ±max(5, |max|) domain.
 */
export function PerformanceHeatmap({ data }: { data: PerformanceDataset }) {
  const [sel, setSel] = useState<{ month: number; col: string } | null>(null);
  const columns = data.table?.columns ?? [];
  const rows = data.table?.rows ?? [];
  if (rows.length === 0 || columns.length === 0) {
    return (
      <ChartShell
        title={`${data.ticker} monthly return grid`}
        subtitle="SEASONALITY"
        footerLeft={`${data.ticker} seasonality map`}
        footerRight={`source ${providerName(data.provider ?? "n/a")}`}
      >
        <PanelNote
          title="No seasonality table"
          detail="Underlying returned no monthly grid for this name."
        />
      </ChartShell>
    );
  }

  let maxAbs = 5;
  for (const row of rows) {
    for (const col of columns) {
      const v = row.values[col];
      if (v != null && Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    }
  }

  const selRow = rows.find((r) => r.month === sel?.month);
  const selValue = sel != null && selRow ? (selRow.values[sel.col] ?? null) : null;

  const headerLabel = (col: string) =>
    col === "Mean 5Y" ? "x̄5Y" : col === "Median 5Y" ? "M5Y" : `'${col.slice(2)}`;

  return (
    <ChartShell
      title={`${data.ticker} monthly return grid`}
      subtitle={`ROLLING 10 YEARS | ROTATED FROM ${safeUpper(data.meta?.selected_month)} | MEAN 5Y ${safeFixed(data.meta?.mean_5y, 1)}%`}
      footerLeft={`${data.ticker} seasonality map`}
      footerRight={`source ${providerName(data.provider ?? "n/a")}`}
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
              const isSel = sel != null && sel.month === row.month && sel.col === col;
              return (
                <Pressable
                  key={col}
                  style={[
                    styles.cell,
                    { backgroundColor: returnHeatColor(t) },
                    isSel && styles.cellSelected,
                  ]}
                  onPress={() => {
                    hapticSelect();
                    setSel(isSel ? null : { month: row.month, col });
                  }}
                  accessibilityRole="button"
                >
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
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      {sel != null && selRow && selValue != null ? (
        <Text style={[styles.readout, { color: selValue >= 0 ? terminal.green : terminal.red }]}>
          {selRow.month_label.toUpperCase()} {sel.col} → {selValue >= 0 ? "+" : ""}
          {selValue.toFixed(2)}%
        </Text>
      ) : null}
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
  cellSelected: { borderWidth: 1.5, borderColor: terminal.amberHot },
  headerText: { color: terminal.muted, fontSize: 7, fontWeight: "700" },
  cellText: { fontSize: 7.5, fontWeight: "700" },
  readout: { fontFamily: MONO_FONT, fontSize: 10, fontWeight: "700" },
  scaleNote: { color: terminal.muted, fontSize: 8, letterSpacing: 0.3 },
});
