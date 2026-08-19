import type { MoneylineDataset } from "@/api/underlying";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { safeFixed } from "./format";
import { MONO_FONT, terminal } from "./palette";
import { ChartShell, Crosshair, LegendRow, Panel, ScrubDot, ScrubTip } from "./primitives";
import { fmtCompact, linearScale } from "./scale";
import { G, Line, Rect, Text as SvgText } from "./view-svg";

const PANEL_HEIGHT = 210;

/**
 * Moneyline: mirrored open-interest bars per strike (calls up green, puts
 * down red), amber spot line, plus the strike-ladder table.
 */
export function MoneylineChart({ data }: { data: MoneylineDataset }) {
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const strikes = data.series?.strikes ?? [];
  const spot = data.meta?.current_price;
  const maxOi =
    strikes.length === 0
      ? 0
      : Math.max(...strikes.map((r) => Math.max(r.call_open_interest, r.put_open_interest)));
  const hasOi = maxOi > 0;

  return (
    <ChartShell
      title={`${data.ticker} moneyline`}
      subtitle={`EXPIRY ${data.meta?.expiry ?? "—"} | SPOT ${safeFixed(spot)}${hasOi ? "" : " | NO OPEN INTEREST REPORTED"}`}
      footerLeft={`${data.ticker} open interest mirror`}
      footerRight="moneyline"
    >
      <Panel
        height={PANEL_HEIGHT}
        scrub={{ count: strikes.length, onIndex: setScrubIdx, padStart: 16, padEnd: 16 }}
      >
        {(w, h) => {
          if (strikes.length === 0) return null;
          const first = strikes[0];
          const last = strikes[strikes.length - 1];
          if (!first || !last) return null;
          const x = linearScale([0, Math.max(1, strikes.length - 1)], [16, w - 16]);
          const oiMax = hasOi ? maxOi * 1.12 : 1;
          const y = linearScale([-oiMax, oiMax], [h - 18, 8]);
          const barWidth = Math.max(6, ((w - 32) / strikes.length) * 0.58);

          // Spot line: interpolate x between the surrounding strikes.
          const strikeValues = strikes.map((r) => r.strike);
          const spotX = (() => {
            if (!Number.isFinite(spot)) return undefined;
            if (spot <= first.strike) return x(0);
            if (spot >= last.strike) return x(strikes.length - 1);
            for (let i = 0; i < strikeValues.length - 1; i++) {
              const a = strikeValues[i];
              const b = strikeValues[i + 1];
              if (a === undefined || b === undefined) continue;
              if (spot >= a && spot <= b) {
                const f = (spot - a) / (b - a || 1);
                return x(i) + f * (x(i + 1) - x(i));
              }
            }
            return x(0);
          })();

          const scrubRow = scrubIdx != null ? strikes[scrubIdx] : undefined;

          return (
            <>
              {[oiMax / 2, oiMax].flatMap((t) =>
                hasOi
                  ? [t, -t].map((v) => (
                      <SvgText
                        key={`oiy-${v}`}
                        x={4}
                        y={y(v) - 2}
                        fill={terminal.muted}
                        fontSize={7.5}
                      >
                        {fmtCompact(Math.abs(v))}
                      </SvgText>
                    ))
                  : [],
              )}
              {strikes.map((row, i) => {
                const cx = x(i);
                const callH = hasOi ? Math.abs(y(row.call_open_interest) - y(0)) : 0;
                const putH = hasOi ? Math.abs(y(-row.put_open_interest) - y(0)) : 0;
                return (
                  <G key={`ml-${row.strike}`}>
                    <Rect
                      x={cx - barWidth / 2}
                      y={y(0) - Math.max(callH, 0.5)}
                      width={barWidth}
                      height={Math.max(callH, 0.5)}
                      fill={terminal.green}
                      opacity={0.86}
                      stroke={terminal.text}
                      strokeWidth={0.25}
                    />
                    <Rect
                      x={cx - barWidth / 2}
                      y={y(0)}
                      width={barWidth}
                      height={Math.max(putH, 0.5)}
                      fill={terminal.red}
                      opacity={0.82}
                      stroke={terminal.text}
                      strokeWidth={0.25}
                    />
                    <SvgText
                      x={cx}
                      y={h - 5}
                      fill={terminal.muted}
                      fontSize={7.5}
                      textAnchor="middle"
                    >
                      {row.strike % 1 === 0 ? row.strike.toFixed(0) : row.strike.toFixed(1)}
                    </SvgText>
                  </G>
                );
              })}
              <Line
                x1={0}
                x2={w}
                y1={y(0)}
                y2={y(0)}
                stroke={terminal.textStrong}
                strokeWidth={1}
              />
              {Number.isFinite(spotX) ? (
                <Line
                  x1={spotX}
                  x2={spotX}
                  y1={4}
                  y2={h - 16}
                  stroke={terminal.amber}
                  strokeWidth={2.2}
                />
              ) : null}
              {scrubIdx != null && scrubRow ? (
                <>
                  <Crosshair x={x(scrubIdx)} top={4} bottom={h - 16} color={terminal.textStrong} />
                  {hasOi ? (
                    <>
                      <ScrubDot
                        cx={x(scrubIdx)}
                        cy={y(scrubRow.call_open_interest)}
                        color={terminal.green}
                      />
                      <ScrubDot
                        cx={x(scrubIdx)}
                        cy={y(-scrubRow.put_open_interest)}
                        color={terminal.red}
                      />
                    </>
                  ) : null}
                  <ScrubTip
                    x={x(scrubIdx)}
                    plotWidth={w}
                    lines={[
                      {
                        text:
                          scrubRow.strike % 1 === 0
                            ? `STRIKE ${scrubRow.strike.toFixed(0)}`
                            : `STRIKE ${scrubRow.strike.toFixed(1)}`,
                        color: terminal.amberHot,
                      },
                      {
                        text: `CALL ${fmtCompact(scrubRow.call_open_interest)}`,
                        color: terminal.green,
                      },
                      {
                        text: `PUT ${fmtCompact(scrubRow.put_open_interest)}`,
                        color: terminal.red,
                      },
                      { text: `P/C ${scrubRow.put_call_ratio.toFixed(2)}`, color: terminal.text },
                    ]}
                  />
                </>
              ) : null}
            </>
          );
        }}
      </Panel>

      <LegendRow
        items={[
          { color: terminal.green, label: "Call OI" },
          { color: terminal.red, label: "Put OI (mirrored)" },
          { color: terminal.amber, label: `Spot ${safeFixed(spot)}` },
        ]}
      />

      <View style={styles.ladder}>
        <Text style={styles.ladderTitle}>STRIKE LADDER</Text>
        <View style={[styles.ladderRow, styles.ladderHeader]}>
          {["Strike", "Call OI", "Put OI", "P/C"].map((label) => (
            <Text key={label} style={styles.ladderHeaderCell}>
              {label}
            </Text>
          ))}
        </View>
        {data.rows.map((row) => (
          <View key={`lr-${row.strike}`} style={styles.ladderRow}>
            <Text style={styles.ladderCell}>{row.strike.toFixed(0)}</Text>
            <Text style={styles.ladderCell}>{row.call_open_interest.toFixed(0)}</Text>
            <Text style={styles.ladderCell}>{row.put_open_interest.toFixed(0)}</Text>
            <Text style={styles.ladderCell}>{row.put_call_ratio.toFixed(2)}</Text>
          </View>
        ))}
      </View>
    </ChartShell>
  );
}

const styles = StyleSheet.create({
  ladder: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 201, 74, 0.34)",
    borderRadius: 6,
    overflow: "hidden",
  },
  ladderTitle: {
    color: terminal.amber,
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: terminal.axBg,
  },
  ladderRow: {
    flexDirection: "row",
    backgroundColor: terminal.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(36, 68, 74, 0.9)",
  },
  ladderHeader: { backgroundColor: terminal.amber },
  ladderHeaderCell: {
    flex: 1,
    color: terminal.chartBg,
    fontSize: 9,
    fontWeight: "800",
    textAlign: "center",
    paddingVertical: 5,
  },
  ladderCell: {
    flex: 1,
    color: terminal.text,
    fontSize: 9.5,
    fontFamily: MONO_FONT,
    textAlign: "center",
    paddingVertical: 4.5,
  },
});
