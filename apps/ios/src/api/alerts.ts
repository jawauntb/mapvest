/**
 * Client for /v1/alerts (price + %-move triggers).
 * Feature-scoped — deliberately does NOT pass through `./client.ts` so the
 * legacy `fetchAlerts` (Underlying-Analyzer batch scan) can keep its name.
 */
import { type FetchOpts, apiFetch } from "./http";

export type AlertKind = "price_above" | "price_below" | "pct_move";

export type PriceAlert = {
  id: string;
  ticker: string;
  kind: AlertKind;
  threshold: number;
  note?: string;
  createdAt: string;
  triggeredAt?: string;
  disabled: boolean;
};

export type CreateAlertInput = {
  ticker: string;
  kind: AlertKind;
  threshold: number;
  note?: string;
};

export function createPriceAlert(
  input: CreateAlertInput,
  opts: FetchOpts,
): Promise<{ alert: PriceAlert }> {
  return apiFetch<{ alert: PriceAlert }>(
    "/v1/alerts",
    { method: "POST", body: JSON.stringify(input) },
    opts,
  );
}

export function listPriceAlerts(opts: FetchOpts): Promise<{ alerts: PriceAlert[] }> {
  return apiFetch<{ alerts: PriceAlert[] }>("/v1/alerts", { method: "GET" }, opts);
}

export function deletePriceAlert(id: string, opts: FetchOpts): Promise<void> {
  return apiFetch<void>(`/v1/alerts/${encodeURIComponent(id)}`, { method: "DELETE" }, opts);
}

export function checkPriceAlerts(opts: FetchOpts): Promise<{ triggered: PriceAlert[] }> {
  return apiFetch<{ triggered: PriceAlert[] }>("/v1/alerts/check", { method: "GET" }, opts);
}

/** Human-readable label for a kind — used in list rows + modal chips. */
export function alertKindLabel(kind: AlertKind): string {
  switch (kind) {
    case "price_above":
      return "Price above";
    case "price_below":
      return "Price below";
    case "pct_move":
      return "% move";
  }
}

/** Compact human summary, e.g. "AAPL above $250" or "TSLA moves 5%+". */
export function alertSummary(alert: Pick<PriceAlert, "ticker" | "kind" | "threshold">): string {
  const t = alert.ticker.toUpperCase();
  switch (alert.kind) {
    case "price_above":
      return `${t} above $${alert.threshold.toFixed(2)}`;
    case "price_below":
      return `${t} below $${alert.threshold.toFixed(2)}`;
    case "pct_move":
      return `${t} moves ${Math.abs(alert.threshold).toFixed(1)}%+`;
  }
}
