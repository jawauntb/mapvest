import { PRISM_HORIZONS, type PrismPacket } from "@/api/prism";
import { CycleWheel, SpectralWave } from "@/chartkit/prism";
import { colors, space, type } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { fmtPct, fmtSignedPct, humanize, sectionUnavailable, toneForValue } from "./format";
import { Chip, KeyValueRow, SectionCard, StatTile } from "./ui";

/**
 * Cycle structure from the rFFT of the detrended log price: where each dominant
 * mode sits on its own cycle, the composite wave they make, and the projection
 * that follows from extrapolating them.
 *
 * The consistency check is the honesty valve — it compares the fit error over
 * the last sixty days against the historical fit-error distribution, so a
 * cycle that has stopped working says so instead of projecting confidently.
 */
export function SpectralSection({ packet }: { packet: PrismPacket }) {
  const spectral = packet.spectral;
  const unavailable = sectionUnavailable(packet, "spectral", spectral);
  const consistency = spectral?.consistency ?? null;
  const projection = spectral?.projection ?? null;

  return (
    <SectionCard
      eyebrow="Spectral"
      title="Cycle position"
      subtitle="Dominant modes of the detrended log price, placed on their own phase."
      unavailable={unavailable}
      right={
        consistency?.likelihood_label ? (
          <Chip label={humanize(consistency.likelihood_label)} tone="neutral" />
        ) : undefined
      }
    >
      <CycleWheel modes={spectral?.modes} />

      <View style={styles.tiles}>
        <StatTile label="Reconstruction R²" value={fmtPct(spectral?.reconstruction_r2, 0)} />
        <StatTile
          label="Recent fit z"
          value={
            consistency?.z === null || consistency?.z === undefined ? "—" : consistency.z.toFixed(2)
          }
          sub={consistency?.likelihood_label ? humanize(consistency.likelihood_label) : undefined}
        />
      </View>

      <Text style={styles.blockTitle}>Composite wave</Text>
      <SpectralWave modes={spectral?.modes} />

      {projection ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.blockTitle}>Cycle projection</Text>
          {PRISM_HORIZONS.map((horizon) => {
            const point = projection[horizon];
            if (!point) return null;
            return (
              <KeyValueRow
                key={horizon}
                label={`${horizon.toUpperCase()}${point.confidence === null || point.confidence === undefined ? "" : ` · ${fmtPct(point.confidence, 0)} confidence`}`}
                value={fmtSignedPct(point.expected_return)}
                tone={toneForValue(point.expected_return)}
              />
            );
          })}
        </View>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", gap: space.sm },
  blockTitle: { color: colors.fgMuted, ...type.label, marginTop: space.xs },
});
