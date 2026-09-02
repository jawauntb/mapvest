import type { PrismPacket } from "@/api/prism";
import { VolatilitySmile } from "@/chartkit/prism";
import { colors, space, type } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { fmtDate, fmtNumber, fmtPct, sectionUnavailable } from "./format";
import { smileCurve } from "./signals";
import { KeyValueRow, SectionCard, StatTile } from "./ui";

const REALIZED_ORDER = ["1m", "3m", "6m", "1y"] as const;

/**
 * Realized versus implied volatility. The percentile beside each realized
 * number is what makes it readable — 34% annualized means nothing until you
 * know it is this ticker's 80th percentile.
 */
export function VolatilitySection({ packet }: { packet: PrismPacket }) {
  const volatility = packet.volatility;
  const unavailable = sectionUnavailable(packet, "volatility", volatility);
  const realized = volatility?.realized ?? {};
  const implied = volatility?.implied ?? null;
  const smile = smileCurve(volatility);

  return (
    <SectionCard
      eyebrow="Volatility"
      title="Realized and implied"
      subtitle={
        implied?.expiry ? `Option chain snapshot, expiry ${fmtDate(implied.expiry)}.` : undefined
      }
      unavailable={unavailable}
    >
      <View style={styles.tiles}>
        <StatTile label="ATM IV" value={fmtPct(implied?.atm_iv, 1)} />
        <StatTile label="25Δ skew" value={fmtPct(implied?.skew_25d, 1)} />
        <StatTile label="Vol of vol" value={fmtNumber(volatility?.vol_of_vol, 2)} />
      </View>

      {smile.length >= 2 ? (
        <VolatilitySmile points={smile} atmIv={implied?.atm_iv ?? null} />
      ) : (
        <Text style={styles.note}>
          No option-chain smile in this packet — the ticker may have no listed options entitlement.
        </Text>
      )}

      <View style={{ gap: 2 }}>
        <Text style={styles.blockTitle}>Realized</Text>
        {REALIZED_ORDER.map((window) => {
          const stat = realized[window];
          if (!stat) return null;
          return (
            <KeyValueRow
              key={window}
              label={`${window.toUpperCase()}${stat.percentile === null || stat.percentile === undefined ? "" : ` · ${fmtPct(stat.percentile, 0)} percentile`}`}
              value={fmtPct(stat.annualized, 1)}
            />
          );
        })}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", gap: space.sm },
  blockTitle: { color: colors.fgMuted, ...type.label, marginTop: space.xs },
  note: { color: colors.fgMuted, fontSize: 12, fontStyle: "italic", lineHeight: 17 },
});
