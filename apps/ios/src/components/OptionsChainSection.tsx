import { fetchOptionContracts, fetchOptionsChain } from "@/api/client";
import type { OptionSnapshot } from "@/api/types";
import { colors, radii, type } from "@/theme/tokens";
import { formatDecimal, formatMoney, formatPct } from "@/util/format";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type Props = {
  ticker: string;
  token?: string;
  underlyingPrice?: number;
};

type Side = "call" | "put";

export function OptionsChainSection({ ticker, token, underlyingPrice }: Props) {
  const [expirations, setExpirations] = useState<string[]>([]);
  const [expiration, setExpiration] = useState<string | null>(null);
  const [contracts, setContracts] = useState<OptionSnapshot[]>([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [chainLoading, setChainLoading] = useState(false);
  const [side, setSide] = useState<Side>("call");
  const [error, setError] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setExpirations([]);
    setExpiration(null);
    setContracts([]);
    setError(null);
    setContractsLoading(true);
    fetchOptionContracts(ticker, { limit: 250 }, { token })
      .then((response) => {
        if (!active) return;
        const dates = [
          ...new Set(
            response.contracts
              .map((contract) => contract.expirationDate)
              .filter((date): date is string => Boolean(date)),
          ),
        ].sort();
        setExpirations(dates);
        setExpiration(dates[0] ?? null);
        if (dates.length === 0) setError("No active option expirations reported.");
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Options unavailable.");
      })
      .finally(() => {
        if (active) setContractsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ticker, token]);

  useEffect(() => {
    if (!expiration) return;
    let active = true;
    setContracts([]);
    setChainError(null);
    setChainLoading(true);
    fetchOptionsChain(ticker, { expirationDate: expiration, limit: 250 }, { token })
      .then((response) => {
        if (active) setContracts(response.contracts);
      })
      .catch((reason) => {
        if (active) setChainError(reason instanceof Error ? reason.message : "Chain unavailable.");
      })
      .finally(() => {
        if (active) setChainLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ticker, token, expiration]);

  const visibleContracts = useMemo(
    () =>
      contracts
        .filter((contract) => contract.contractType === side)
        .sort((a, b) => (a.strikePrice ?? 0) - (b.strikePrice ?? 0))
        .slice(0, 14),
    [contracts, side],
  );
  const highestOpenInterest = contracts.reduce<OptionSnapshot | undefined>(
    (best, contract) =>
      (contract.openInterest ?? 0) > (best?.openInterest ?? 0) ? contract : best,
    undefined,
  );
  const averageIv = average(contracts.map((contract) => contract.impliedVolatility));

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Options · Massive</Text>
      <Text style={styles.sub}>Snapshot chain for research, not an order ticket.</Text>

      {contractsLoading ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>Finding active expirations…</Text>
        </View>
      ) : error ? (
        <Text style={styles.muted}>{error}</Text>
      ) : expirations.length === 0 ? (
        <Text style={styles.muted}>No active options data for {ticker}.</Text>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {expirations.slice(0, 8).map((date) => (
              <Pressable
                key={date}
                onPress={() => setExpiration(date)}
                style={[styles.chip, expiration === date && styles.chipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: expiration === date }}
              >
                <Text style={[styles.chipText, expiration === date && styles.chipTextActive]}>
                  {date}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.summaryGrid}>
            <Summary label="Spot" value={formatMoney(underlyingPrice)} />
            <Summary label="Contracts" value={String(contracts.length)} />
            <Summary label="Avg IV" value={formatPct(averageIv)} />
            <Summary
              label="Max OI"
              value={
                highestOpenInterest
                  ? `${formatDecimal(highestOpenInterest.openInterest, 0)} · ${formatMoney(highestOpenInterest.strikePrice)}`
                  : "—"
              }
            />
          </View>

          <View style={styles.sideRow}>
            {(["call", "put"] as const).map((nextSide) => (
              <Pressable
                key={nextSide}
                onPress={() => setSide(nextSide)}
                style={[styles.sideButton, side === nextSide && styles.sideButtonActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: side === nextSide }}
              >
                <Text style={[styles.sideText, side === nextSide && styles.sideTextActive]}>
                  {nextSide === "call" ? "Calls" : "Puts"}
                </Text>
              </Pressable>
            ))}
          </View>

          {chainLoading ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.muted}>Loading {expiration} chain…</Text>
            </View>
          ) : chainError ? (
            <Text style={styles.muted}>{chainError}</Text>
          ) : visibleContracts.length === 0 ? (
            <Text style={styles.muted}>
              No {side} contracts reported for {expiration}.
            </Text>
          ) : (
            <View style={styles.table}>
              <View style={styles.tableRow}>
                <Text style={[styles.cell, styles.headerCell]}>Strike</Text>
                <Text style={[styles.cell, styles.headerCell]}>Bid / ask</Text>
                <Text style={[styles.cell, styles.headerCell]}>IV · Δ</Text>
                <Text style={[styles.cell, styles.headerCell]}>OI</Text>
              </View>
              {visibleContracts.map((contract) => (
                <View key={contract.ticker} style={styles.tableRow}>
                  <Text style={[styles.cell, styles.strike]}>
                    {formatMoney(contract.strikePrice)}
                  </Text>
                  <Text style={styles.cell}>
                    {formatMoney(contract.quote?.bid)} / {formatMoney(contract.quote?.ask)}
                  </Text>
                  <Text style={styles.cell}>
                    {formatPct(contract.impliedVolatility)} ·{" "}
                    {formatDecimal(contract.greeks?.delta)}
                  </Text>
                  <Text style={styles.cell}>{formatDecimal(contract.openInterest, 0)}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function average(values: Array<number | undefined>): number | undefined {
  const finite = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : undefined;
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  title: { color: colors.fg, ...type.h3, fontSize: 17 },
  sub: { color: colors.fgMuted, fontSize: 12 },
  muted: { color: colors.fgMuted, fontSize: 12, lineHeight: 17 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  chips: { gap: 6, paddingVertical: 2 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.bgElevated,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.accent },
  chipText: { color: colors.fgMuted, fontSize: 11, fontWeight: "700" },
  chipTextActive: { color: colors.accentInk },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  summaryItem: {
    minWidth: "23%",
    flexGrow: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 9,
    backgroundColor: colors.bgElevated,
  },
  summaryLabel: {
    color: colors.fgDim,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryValue: { color: colors.fg, fontSize: 13, fontWeight: "700", marginTop: 3 },
  sideRow: { flexDirection: "row", gap: 6 },
  sideButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  sideButtonActive: { borderColor: colors.fg, backgroundColor: colors.bgElevated },
  sideText: { color: colors.fgMuted, fontSize: 12, fontWeight: "700" },
  sideTextActive: { color: colors.fg },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, overflow: "hidden" },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 9,
    gap: 5,
  },
  cell: { flex: 1, color: colors.fgMuted, fontSize: 10 },
  headerCell: { color: colors.fgDim, fontWeight: "700", textTransform: "uppercase" },
  strike: { color: colors.fg, fontWeight: "700" },
});

export default OptionsChainSection;
