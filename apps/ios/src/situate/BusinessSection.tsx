import type { SituatePacket } from "@/api/situate";
import { colors, radii, space } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { fmtDate, fmtMultiple, fmtPct, fmtZ, humanize, toneForLabel } from "./format";
import { businessRows, filingCards, sectionUnavailable } from "./signals";
import { Chip, KeyValueRow, SectionCard, toneFg } from "./ui";

/**
 * What the business is saying (SPEC 5.5 / 5.6): momentum, quality, and value
 * z-scores; the 8-quarter trajectory flags; filing-diff cards with the quoted
 * evidence; and dated news events. Revisions and PEAD are stated as
 * unavailable — Massive has no estimates endpoint — rather than faked.
 */
export function BusinessSection({ packet }: { packet: SituatePacket }) {
  const fundamentals = packet.fundamentals;
  const text = packet.text;
  const fUnavailable = sectionUnavailable(packet, "fundamentals", fundamentals);
  const rows = businessRows(fundamentals);
  const cards = filingCards(text?.filing_changes);
  const events = text?.events ?? [];
  const flags = fundamentals?.trajectory_flags ?? null;
  const gap = fundamentals?.revisions_error ?? fundamentals?.pead_error ?? null;

  return (
    <SectionCard eyebrow="Business" title="What the business is saying" unavailable={fUnavailable}>
      {fundamentals ? (
        <>
          {flags ? (
            <View style={styles.chips}>
              <Chip
                label={`Revenue ${flags.rev_accel ? "accelerating" : "steady/decel"}`}
                tone={flags.rev_accel ? "bull" : "neutral"}
              />
              <Chip
                label={`Margins ${flags.margin_accel ? "accelerating" : "steady/decel"}`}
                tone={flags.margin_accel ? "bull" : "neutral"}
              />
            </View>
          ) : null}

          {rows.length > 0 ? (
            <View>
              {rows.map((r) => (
                <KeyValueRow
                  key={r.label}
                  label={r.label}
                  tone={r.tone}
                  value={
                    r.kind === "pct"
                      ? fmtPct(r.value, 1)
                      : r.kind === "z"
                        ? fmtZ(r.value)
                        : r.kind === "x"
                          ? fmtMultiple(r.value)
                          : String(r.value ?? "—")
                  }
                />
              ))}
              {fundamentals.value_z?.basis ? (
                <Text style={styles.basis}>
                  Value z-scores vs {humanize(fundamentals.value_z.basis)}.
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.gapRow}>
            <Ionicons name="alert-circle-outline" size={13} color={colors.fgDim} />
            <Text style={styles.gap}>
              Revision momentum and PEAD are unavailable
              {gap ? `: ${gap}` : " — no estimate provider"}.
            </Text>
          </View>
        </>
      ) : null}

      {cards.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Text style={styles.blockTitle}>Filing changes</Text>
          {cards.map((card) => (
            <View key={card.section} style={styles.filing}>
              <View style={styles.filingHead}>
                <Text style={styles.filingSection}>{card.section}</Text>
                {card.materialScore !== null ? (
                  <Chip
                    label={`Material ${card.materialScore}/5`}
                    tone={
                      card.materialScore >= 4
                        ? "bear"
                        : card.materialScore >= 2
                          ? "neutral"
                          : "bull"
                    }
                  />
                ) : null}
              </View>
              {card.newRisks.map((risk) => (
                <View key={risk.text} style={{ gap: 2 }}>
                  <Text style={styles.riskText}>· {risk.text}</Text>
                  {risk.quote ? <Text style={styles.quote}>“{risk.quote}”</Text> : null}
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {events.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={styles.blockTitle}>Recent events</Text>
          {events.slice(0, 6).map((e) => (
            <View key={`${e.date ?? ""}-${e.headline ?? ""}`} style={styles.event}>
              <Text style={[styles.eventDot, { color: toneFg(toneForLabel(e.sentiment)) }]}>•</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.eventHead} numberOfLines={2}>
                  {e.headline ?? humanize(e.type)}
                </Text>
                <Text style={styles.eventMeta}>
                  {fmtDate(e.date)}
                  {e.type ? ` · ${humanize(e.type)}` : ""}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  basis: { color: colors.fgMuted, fontSize: 11, marginTop: 4, fontStyle: "italic" },
  gapRow: { flexDirection: "row", alignItems: "flex-start", gap: 5 },
  gap: { color: colors.fgMuted, fontSize: 11.5, lineHeight: 16, flex: 1 },
  blockTitle: {
    color: colors.fgMuted,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
    marginTop: space.xs,
  },
  filing: {
    backgroundColor: colors.bgSunken,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
    gap: 6,
  },
  filingHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.sm,
  },
  filingSection: { color: colors.fg, fontSize: 12.5, fontWeight: "800", flexShrink: 1 },
  riskText: { color: colors.fg, fontSize: 12.5, lineHeight: 18 },
  quote: {
    color: colors.fgMuted,
    fontSize: 12,
    lineHeight: 17,
    fontStyle: "italic",
    paddingLeft: 10,
  },
  event: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  eventDot: { fontSize: 14, lineHeight: 18 },
  eventHead: { color: colors.fg, fontSize: 12.5, lineHeight: 17 },
  eventMeta: { color: colors.fgMuted, fontSize: 10.5 },
});
