import { colors, radii } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { chart } from "./theme";

/**
 * The 2×2 state grid: volatility (rows) × trend (columns), with the current
 * cell lit. This is the state we condition the odds on — a mostly *vol* state
 * (SPEC §2.2), so the grid foregrounds which vol row you're in and whether the
 * trend leans up or down, not a direction call.
 *
 * `volState`/`trendState` are the packet's own words ("high"/"low",
 * "up"/"down"); anything else leaves every cell unlit, which is the honest
 * rendering of an unknown state.
 */
export function StateGrid({
  volState,
  trendState,
}: {
  volState: string | null;
  trendState: string | null;
}) {
  const vol = (volState ?? "").toLowerCase();
  const trend = (trendState ?? "").toLowerCase();
  const cells: Array<{ v: "high" | "low"; t: "down" | "up"; label: string }> = [
    { v: "high", t: "down", label: "High vol · down" },
    { v: "high", t: "up", label: "High vol · up" },
    { v: "low", t: "down", label: "Low vol · down" },
    { v: "low", t: "up", label: "Low vol · up" },
  ];
  return (
    <View style={styles.grid}>
      {cells.map((cell) => {
        const active = cell.v === vol && cell.t === trend;
        const tone = cell.t === "up" ? chart.bull : chart.bear;
        return (
          <View
            key={cell.label}
            style={[styles.cell, active && { borderColor: tone, backgroundColor: `${tone}22` }]}
          >
            <Text style={[styles.cellText, active && { color: colors.fg, fontWeight: "800" }]}>
              {cell.label}
            </Text>
            {active ? <Text style={[styles.now, { color: tone }]}>NOW</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: {
    flexGrow: 1,
    flexBasis: "46%",
    minHeight: 52,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: "center",
    gap: 2,
  },
  cellText: { color: colors.fgMuted, fontSize: 12, fontWeight: "600" },
  now: { fontSize: 9, fontWeight: "800", letterSpacing: 0.6 },
});
