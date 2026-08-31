"use client";

import { type OptionSnapshot, getOptionContracts, getOptionsChain } from "@/lib/mapvest-api";
import { useEffect, useMemo, useState } from "react";

type Props = {
  ticker: string;
  underlyingPrice?: number;
};

type Side = "call" | "put";

export function OptionsPanel({ ticker, underlyingPrice }: Props) {
  const [expirations, setExpirations] = useState<string[]>([]);
  const [expiration, setExpiration] = useState<string | null>(null);
  const [chain, setChain] = useState<OptionSnapshot[]>([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [chainLoading, setChainLoading] = useState(false);
  const [side, setSide] = useState<Side>("call");
  const [error, setError] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setExpirations([]);
    setExpiration(null);
    setChain([]);
    setError(null);
    setContractsLoading(true);
    getOptionContracts(ticker, { limit: 250 })
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
  }, [ticker]);

  useEffect(() => {
    if (!expiration) return;
    let active = true;
    setChain([]);
    setChainError(null);
    setChainLoading(true);
    getOptionsChain(ticker, { expirationDate: expiration, limit: 250 })
      .then((response) => {
        if (active) setChain(response.contracts);
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
  }, [ticker, expiration]);

  const visibleContracts = useMemo(
    () =>
      chain
        .filter((contract) => contract.contractType === side)
        .sort((a, b) => (a.strikePrice ?? 0) - (b.strikePrice ?? 0))
        .slice(0, 14),
    [chain, side],
  );
  const highestOpenInterest = chain.reduce<OptionSnapshot | undefined>(
    (best, contract) =>
      (contract.openInterest ?? 0) > (best?.openInterest ?? 0) ? contract : best,
    undefined,
  );
  const averageIv = average(chain.map((contract) => contract.impliedVolatility));

  return (
    <section className="app-panel">
      <h2>Options chain</h2>
      <p className="app-muted">Snapshot chain for research, not an order ticket.</p>

      {contractsLoading ? <p className="app-muted">Finding active expirations…</p> : null}
      {!contractsLoading && error ? <p className="app-err">{error}</p> : null}
      {!contractsLoading && !error && expirations.length === 0 ? (
        <p className="app-muted">No active options data for {ticker}.</p>
      ) : null}

      {!contractsLoading && !error && expirations.length > 0 ? (
        <>
          <div className="app-chart-chips" role="tablist" aria-label="Option expiration">
            {expirations.slice(0, 8).map((date) => (
              <button
                key={date}
                type="button"
                className={`app-chip ${expiration === date ? "app-chip-active" : ""}`}
                onClick={() => setExpiration(date)}
                aria-selected={expiration === date}
                role="tab"
              >
                {date}
              </button>
            ))}
          </div>

          <dl className="app-snapshot">
            <div>
              <dt>Spot</dt>
              <dd>{formatMoney(underlyingPrice)}</dd>
            </div>
            <div>
              <dt>Contracts</dt>
              <dd>{chain.length}</dd>
            </div>
            <div>
              <dt>Avg IV</dt>
              <dd>{formatPercent(averageIv)}</dd>
            </div>
            <div>
              <dt>Max OI</dt>
              <dd>
                {highestOpenInterest
                  ? `${formatNumber(highestOpenInterest.openInterest)} · ${formatMoney(highestOpenInterest.strikePrice)}`
                  : "—"}
              </dd>
            </div>
          </dl>

          <div className="app-chart-chips" role="tablist" aria-label="Option type">
            {(["call", "put"] as const).map((nextSide) => (
              <button
                key={nextSide}
                type="button"
                className={`app-chip ${side === nextSide ? "app-chip-active" : ""}`}
                onClick={() => setSide(nextSide)}
                aria-selected={side === nextSide}
                role="tab"
              >
                {nextSide === "call" ? "Calls" : "Puts"}
              </button>
            ))}
          </div>

          {chainLoading ? <p className="app-muted">Loading {expiration} chain…</p> : null}
          {!chainLoading && chainError ? <p className="app-err">{chainError}</p> : null}
          {!chainLoading && !chainError && visibleContracts.length === 0 ? (
            <p className="app-muted">
              No {side} contracts reported for {expiration}.
            </p>
          ) : null}
          {!chainLoading && !chainError && visibleContracts.length > 0 ? (
            <table className="app-options-table">
              <caption className="app-sr-only">{side} options chain</caption>
              <thead>
                <tr className="app-options-row app-options-head">
                  <th scope="col">Strike</th>
                  <th scope="col">Bid / ask</th>
                  <th scope="col">IV · Δ</th>
                  <th scope="col">OI</th>
                </tr>
              </thead>
              <tbody>
                {visibleContracts.map((contract) => (
                  <tr className="app-options-row" key={contract.ticker}>
                    <th scope="row">{formatMoney(contract.strikePrice)}</th>
                    <td>
                      {formatMoney(contract.quote?.bid)} / {formatMoney(contract.quote?.ask)}
                    </td>
                    <td>
                      {formatPercent(contract.impliedVolatility)} ·{" "}
                      {formatDecimal(contract.greeks?.delta)}
                    </td>
                    <td>{formatNumber(contract.openInterest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function average(values: Array<number | undefined>): number | undefined {
  const finite = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : undefined;
}

function formatMoney(value?: number): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "—";
}

function formatPercent(value?: number): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function formatDecimal(value?: number): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

function formatNumber(value?: number): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "—";
}
