import type { SituatePacket, SituateScenarioCase } from "@/api/situate";
import { colors, radii, space } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { fmtSignedPct, humanize } from "./format";
import { sectionUnavailable } from "./signals";
import { Chip, SectionCard } from "./ui";

const CASES: Array<{
  key: "bull" | "neutral" | "bear";
  label: string;
  tone: "bull" | "neutral" | "bear";
}> = [
  { key: "bull", label: "Bull", tone: "bull" },
  { key: "neutral", label: "Neutral", tone: "neutral" },
  { key: "bear", label: "Bear", tone: "bear" },
];

/**
 * Bull / neutral / bear scenarios (SPEC §6.6): each defined by a state and the
 * corresponding quantile at each horizon, with its top exposure drivers. No
 * probabilities are asserted as certainties — a scenario is a description of a
 * state, not a forecast of which one happens.
 */
export function ScenariosSection({ packet }: { packet: SituatePacket }) {
  const scenarios = packet.scenarios;
  const unavailable = sectionUnavailable(packet, "scenarios", scenarios);

  return (
    <SectionCard eyebrow="Scenarios" title="Bull · neutral · bear" unavailable={unavailable}>
      {scenarios
        ? CASES.map(({ key, label, tone }) => {
            const scenario = scenarios[key] as SituateScenarioCase | null | undefined;
            if (!scenario) return null;
            const horizons = scenario.horizons ?? {};
            const entries = Object.entries(horizons).filter(([, v]) => v);
            return (
              <View key={key} style={styles.case}>
                <View style={styles.caseHead}>
                  <Chip label={label} tone={tone} solid />
                  {scenario.state ? (
                    <Text style={styles.state}>{humanize(scenario.state)}</Text>
                  ) : null}
                </View>
                {entries.length > 0 ? (
                  <View style={styles.hRow}>
                    {entries.slice(0, 4).map(([h, v]) => (
                      <View key={h} style={styles.hCell}>
                        <Text style={styles.hLabel}>{h}M</Text>
                        <Text style={styles.hValue}>{fmtSignedPct(v?.quantile, 0)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {(() => {
                  const drivers = entries.flatMap(([, v]) => v?.drivers ?? []).slice(0, 3);
                  return drivers.length > 0 ? (
                    <Text style={styles.drivers}>Drivers: {drivers.join(", ")}</Text>
                  ) : null;
                })()}
              </View>
            );
          })
        : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  case: {
    backgroundColor: colors.bgSunken,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: 6,
  },
  caseHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  state: { color: colors.fgMuted, fontSize: 12, fontWeight: "600" },
  hRow: { flexDirection: "row", gap: space.md },
  hCell: { gap: 2 },
  hLabel: { color: colors.fgMuted, fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  hValue: { color: colors.fg, fontSize: 13, fontWeight: "700" },
  drivers: { color: colors.fgMuted, fontSize: 11.5, lineHeight: 16 },
});
