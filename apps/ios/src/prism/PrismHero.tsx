import type { PrismPacket } from "@/api/prism";
import { colors, fonts, radii, space, type } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import {
  clamp01,
  convictionLabel,
  fmtDate,
  fmtPct,
  fmtPrice,
  fmtSignedPct,
  humanize,
  isPacketStale,
  recommendationLabel,
  recommendationTone,
  relativeAge,
  toneForValue,
} from "./format";
import { entryBand, exitLadder, ladderBasis } from "./scenario";
import { Chip, KeyValueRow, Meter, StatTile, toneBg, toneFg } from "./ui";

/**
 * The hero: what Prism concluded, how strongly, and where the price sits
 * against its own fair-value distribution.
 *
 * The recommendation chip is the only place the action grammar is stated, and
 * it is always paired with the conviction meter — a "strong buy" at 0.3
 * conviction has to look different from one at 0.9, or the chip is a lie.
 *
 * The big number is the entry block's `current_price` and nothing else. It is
 * the session close the packet was built from, so it is captioned with that
 * date, and a packet older than a few days says so in the hero rather than only
 * in the provenance card at the bottom of the page. There is no fallback to
 * another quantity: `memo.entry_price` is a *bargain threshold* (the engine
 * seeds it from `entry.bargain_below`) or a model-authored number, and printing
 * either in the slot a reader takes for "the price" would be a different
 * quantity wearing the same label.
 */
export function PrismHero({ packet }: { packet: PrismPacket }) {
  const memo = packet.memo;
  const rec = memo?.recommendation ?? null;
  const tone = recommendationTone(rec?.action);
  const profile = packet.profile;
  const band = entryBand(packet.scenarios?.entry);
  const current = band.current;
  const ladder = exitLadder(memo?.exit_targets, current);
  const basis = ladderBasis(ladder);
  const recent = packet.recent?.last_20d ?? null;
  const stale = isPacketStale(packet.generated_at);

  const posOf = (value: number | null): number | null => {
    if (value === null || band.axisMin === null || band.axisMax === null) return null;
    const span = band.axisMax - band.axisMin;
    if (!(span > 0)) return null;
    return clamp01((value - band.axisMin) / span);
  };

  return (
    <View style={styles.hero}>
      <View style={styles.headRow}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.ticker}>{packet.ticker}</Text>
          <Text style={styles.name} numberOfLines={2}>
            {profile?.name ?? "Company profile unavailable"}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[profile?.sector, profile?.industry, profile?.primary_exchange]
              .filter((v): v is string => typeof v === "string" && v.length > 0)
              .join(" · ") || "Sector unavailable"}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Text style={styles.price}>{fmtPrice(current)}</Text>
          <Text style={styles.priceCaption} numberOfLines={1}>
            {current === null ? "no price in this packet" : `close · ${fmtDate(packet.as_of)}`}
          </Text>
          {recent?.return === undefined || recent?.return === null ? null : (
            <Text style={[styles.recent, { color: toneFg(toneForValue(recent.return)) }]}>
              {fmtSignedPct(recent.return)} · 20d
            </Text>
          )}
        </View>
      </View>

      {stale ? (
        <Text style={styles.stale}>
          Built {relativeAge(packet.generated_at)}. Every price here is that day's close — rebuild
          for current prices.
        </Text>
      ) : null}

      <View style={[styles.recBlock, { backgroundColor: toneBg(tone), borderColor: toneFg(tone) }]}>
        <View style={styles.recRow}>
          <Chip label={recommendationLabel(rec?.action)} tone={tone} solid />
          <Text style={styles.strength}>
            {rec
              ? `${humanize(rec.strength)} · ${convictionLabel(rec.conviction)}`
              : "No memo in this packet"}
          </Text>
        </View>
        {rec ? (
          <View style={{ gap: 5 }}>
            <Meter value={rec.conviction} tone={tone} />
            <Text style={styles.convictionValue}>{fmtPct(rec.conviction, 0)} conviction</Text>
          </View>
        ) : null}
        {rec?.one_line ? <Text style={styles.thesis}>{rec.one_line}</Text> : null}
      </View>

      {band.axisMin === null ? (
        <Text style={styles.noBand}>
          Entry zone unavailable — the engine did not produce a fair-value distribution.
        </Text>
      ) : (
        <View style={styles.bandBlock}>
          <View style={styles.bandHead}>
            <Text style={styles.bandTitle}>Entry zone</Text>
            <Text
              style={[
                styles.bandZone,
                {
                  color: toneFg(
                    band.zone === "bargain"
                      ? "bull"
                      : band.zone === "expensive"
                        ? "bear"
                        : "neutral",
                  ),
                },
              ]}
            >
              {band.zone
                ? `${humanize(band.zone)}${band.vsFair === null ? "" : ` · ${fmtSignedPct(band.vsFair)} vs fair`}`
                : "—"}
            </Text>
          </View>
          <View style={styles.track}>
            <View style={styles.trackBase} />
            {(() => {
              const a = posOf(band.bargain);
              const b = posOf(band.expensive);
              if (a === null || b === null || b <= a) return null;
              return (
                <View
                  style={[styles.trackFair, { left: `${a * 100}%`, width: `${(b - a) * 100}%` }]}
                />
              );
            })()}
            {(
              [
                { key: "bargain", value: band.bargain, color: colors.accent },
                { key: "fair", value: band.fair, color: colors.fgMuted },
                { key: "expensive", value: band.expensive, color: colors.danger },
              ] as const
            ).map((mark) => {
              const p = posOf(mark.value);
              if (p === null) return null;
              return (
                <View
                  key={mark.key}
                  style={[styles.tick, { left: `${p * 100}%`, backgroundColor: mark.color }]}
                />
              );
            })}
            {band.t === null ? null : (
              <View style={[styles.nowPin, { left: `${band.t * 100}%` }]}>
                <View style={styles.nowDot} />
              </View>
            )}
          </View>
          <View style={styles.bandLabels}>
            <Text style={styles.bandLabel}>Bargain {fmtPrice(band.bargain)}</Text>
            <Text style={[styles.bandLabel, styles.bandLabelMid]}>Fair {fmtPrice(band.fair)}</Text>
            <Text style={[styles.bandLabel, styles.bandLabelEnd]}>
              Expensive {fmtPrice(band.expensive)}
            </Text>
          </View>
        </View>
      )}

      {ladder.length > 0 ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.blockTitle}>Exit targets</Text>
          {ladder.map((row) => (
            <KeyValueRow
              key={`${row.horizon}-${row.price ?? "na"}`}
              // `probability` is the bull case's probability at this horizon,
              // which the engine copied off the block it took `price_p50` from
              // — it is NOT the chance of the price being reached (that would
              // be roughly half of it). Label the fact, not the inference.
              label={`${row.horizon.toUpperCase()}${row.probability === null ? "" : ` · bull case ${fmtPct(row.probability, 0)}`}`}
              value={`${fmtPrice(row.price)}${row.ret === null ? "" : `  ${fmtSignedPct(row.ret)}`}`}
              tone={toneForValue(row.ret)}
            />
          ))}
          <Text style={styles.ladderNote}>
            {basis ? `Each target is the ${basis}. ` : ""}The percentage is the bull case&apos;s own
            probability at that horizon, not the chance of reaching the price.
          </Text>
          {typeof memo?.stop_or_reassess === "number" ? (
            <KeyValueRow
              label="Reassess below"
              value={fmtPrice(memo.stop_or_reassess)}
              tone="bear"
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.tiles}>
        <StatTile
          label="As of"
          value={fmtDate(packet.as_of)}
          sub={`built ${relativeAge(packet.generated_at)}`}
        />
        <StatTile
          label="20d vs SPY"
          value={fmtSignedPct(recent?.vs_spy)}
          tone={toneForValue(recent?.vs_spy)}
        />
        <StatTile label="Regime" value={humanize(recent?.regime, "—")} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: space.lg,
    gap: space.lg,
  },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  ticker: { color: colors.fg, ...type.h1 },
  name: { color: colors.fg, fontSize: 14, fontWeight: "600" },
  meta: { color: colors.fgMuted, fontSize: 11.5 },
  price: { color: colors.fg, fontSize: 22, fontWeight: "800" },
  priceCaption: { color: colors.fgMuted, fontSize: 10.5, letterSpacing: 0.2 },
  stale: {
    color: colors.warn,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  ladderNote: { color: colors.fgMuted, fontSize: 10.5, lineHeight: 15, marginTop: 4 },
  recent: { fontSize: 12, fontWeight: "700" },
  recBlock: {
    borderWidth: 1,
    borderRadius: radii.md,
    padding: space.md,
    gap: space.sm,
  },
  recRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  strength: { color: colors.fgMuted, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  convictionValue: { color: colors.fgMuted, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.4 },
  thesis: {
    color: colors.fg,
    fontFamily: fonts.serif,
    fontSize: 15,
    lineHeight: 22,
  },
  bandBlock: { gap: space.sm },
  bandHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  bandTitle: { color: colors.fgMuted, ...type.label },
  bandZone: { fontSize: 12, fontWeight: "700" },
  track: { height: 26, justifyContent: "center" },
  trackBase: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.bgSunken,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  trackFair: {
    position: "absolute",
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(20, 196, 166, 0.18)",
  },
  tick: { position: "absolute", width: 2, height: 14, borderRadius: 1, opacity: 0.9 },
  nowPin: { position: "absolute", alignItems: "center", marginLeft: -6 },
  nowDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.fg,
    borderWidth: 2,
    borderColor: colors.bgElevated,
  },
  bandLabels: { flexDirection: "row", justifyContent: "space-between", gap: 6 },
  bandLabel: { color: colors.fgMuted, fontSize: 10.5, flex: 1 },
  bandLabelMid: { textAlign: "center" },
  bandLabelEnd: { textAlign: "right" },
  blockTitle: { color: colors.fgMuted, ...type.label, marginBottom: 2 },
  noBand: { color: colors.fgMuted, fontSize: 12, fontStyle: "italic", lineHeight: 17 },
  tiles: { flexDirection: "row", gap: space.sm },
});
