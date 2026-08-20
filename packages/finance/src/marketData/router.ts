import type { HistoryInterval, HistoryPeriod } from "./historyIntervals.js";
import type {
  CashFlowStatement,
  FinancialStatementPage,
  FinancialStatementQuery,
  IncomeStatement,
} from "./massive.js";
import { massiveClient } from "./massive.js";
import { MarketDataProviderError } from "./types.js";
import type {
  AggregateBar,
  AggregatePage,
  AggregateQuery,
  CorporateEvent,
  FinancialRatio,
  FinancialRatios,
  FinancialRatiosQuery,
  HistoryPoint,
  MarketDataCapabilities,
  MarketDataProvider,
  MarketDataProviderName,
  OptionAggregateQuery,
  OptionContract,
  OptionContractQuery,
  OptionSnapshot,
  OptionSnapshotQuery,
  OptionsChainQuery,
  ProviderPage,
} from "./types.js";
import { yahooProvider } from "./yahoo.js";

function providerName(
  value: string | undefined,
  fallback: MarketDataProviderName,
): MarketDataProviderName {
  return value === "yahoo" || value === "massive" ? value : fallback;
}

export function getPrimaryProvider(): MarketDataProvider {
  const configured = process.env.MARKET_DATA_PRIMARY?.trim() || process.env.MARKET_DATA_PROVIDER;
  return providerName(configured?.toLowerCase(), "massive") === "yahoo"
    ? yahooProvider
    : massiveClient;
}

export function getFallbackProvider(): MarketDataProvider | null {
  const configured = process.env.MARKET_DATA_FALLBACK_PROVIDER?.trim().toLowerCase();
  return configured === "yahoo" ? yahooProvider : null;
}

async function withFallback<T>(
  operation: (provider: MarketDataProvider) => Promise<T>,
): Promise<T> {
  const primary = getPrimaryProvider();
  try {
    return await operation(primary);
  } catch (error) {
    const fallback = getFallbackProvider();
    if (!fallback || fallback.name === primary.name) throw error;
    return operation(fallback);
  }
}

async function withNullableFallback<T>(
  operation: (provider: MarketDataProvider) => Promise<T | null>,
): Promise<T | null> {
  const primary = getPrimaryProvider();
  let value: T | null;
  try {
    value = await operation(primary);
  } catch (error) {
    const fallback = getFallbackProvider();
    if (!fallback || fallback.name === primary.name) throw error;
    return operation(fallback);
  }
  const usable = value !== null && (!Array.isArray(value) || value.length > 0);
  if (usable) return value;
  const fallback = getFallbackProvider();
  if (!fallback || fallback.name === primary.name) return value;
  return operation(fallback);
}

async function withNullableFallbackProvider<T>(
  operation: (provider: MarketDataProvider) => Promise<T | null>,
): Promise<{ value: T | null; provider: MarketDataProviderName }> {
  const primary = getPrimaryProvider();
  let value: T | null;
  try {
    value = await operation(primary);
  } catch (error) {
    const fallback = getFallbackProvider();
    if (!fallback || fallback.name === primary.name) throw error;
    return { value: await operation(fallback), provider: fallback.name };
  }
  const usable = value !== null && (!Array.isArray(value) || value.length > 0);
  if (usable) return { value, provider: primary.name };
  const fallback = getFallbackProvider();
  if (!fallback || fallback.name === primary.name) return { value, provider: primary.name };
  return { value: await operation(fallback), provider: fallback.name };
}

export function getMarketDataCapabilities(): MarketDataCapabilities {
  const primary = getPrimaryProvider();
  const primaryCapabilities = primary.capabilities();
  const fallback = getFallbackProvider();
  if (!fallback || fallback.name === primary.name) return primaryCapabilities;
  const fallbackCapabilities = fallback.capabilities();
  if (!primaryCapabilities.configured && fallbackCapabilities.configured) {
    return {
      ...fallbackCapabilities,
      datasets: { ...primaryCapabilities.datasets, ...fallbackCapabilities.datasets },
    };
  }
  const datasets = { ...primaryCapabilities.datasets };
  for (const [key, value] of Object.entries(fallbackCapabilities.datasets)) {
    if (!datasets[key]?.supported && value.supported) datasets[key] = value;
  }
  return { ...primaryCapabilities, datasets };
}

export const getQuote = (symbol: string) =>
  withNullableFallback((provider) => provider.getQuote(symbol));
export const getHistoricalCloses = (
  symbol: string,
  period: HistoryPeriod,
  interval: HistoryInterval = "1d",
) => withNullableFallback((provider) => provider.getHistoricalCloses(symbol, period, interval));
export const getHistoricalClosesWithProvider = (
  symbol: string,
  period: HistoryPeriod,
  interval: HistoryInterval = "1d",
) =>
  withNullableFallbackProvider((provider) =>
    provider.getHistoricalCloses(symbol, period, interval),
  );
export const getAggregates = (query: AggregateQuery) =>
  withFallback((provider) => provider.getAggregates(query));
export const getAggregatesPage = (query: AggregateQuery) =>
  withFallback((provider) => provider.getAggregatesPage(query));
export const getFinancialRatios = (query: FinancialRatiosQuery = {}) =>
  withFallback((provider) => {
    if (!provider.getFinancialRatios) {
      throw new MarketDataProviderError("Provider does not support financial ratios", {
        provider: provider.name,
        status: 501,
        code: "unsupported",
      });
    }
    return provider.getFinancialRatios(query);
  });
/**
 * Providers that expose the financial-statement families. Declared structurally
 * (rather than on `MarketDataProvider`) because the statement endpoints are a
 * Massive-only dataset: Yahoo has no equivalent and must surface the same
 * `501 unsupported` this router raises for option snapshots/aggregates.
 */
type StatementProvider = MarketDataProvider & {
  getIncomeStatements?: (
    symbol: string,
    query: FinancialStatementQuery,
  ) => Promise<FinancialStatementPage<IncomeStatement>>;
  getCashFlowStatements?: (
    symbol: string,
    query: FinancialStatementQuery,
  ) => Promise<FinancialStatementPage<CashFlowStatement>>;
};

export const getIncomeStatements = (symbol: string, query: FinancialStatementQuery = {}) =>
  withFallback((provider) => {
    const capable = provider as StatementProvider;
    if (typeof capable.getIncomeStatements !== "function") {
      throw new MarketDataProviderError("Provider does not support income statements", {
        provider: provider.name,
        status: 501,
        code: "unsupported",
      });
    }
    return capable.getIncomeStatements(symbol, query);
  });

export const getCashFlowStatements = (symbol: string, query: FinancialStatementQuery = {}) =>
  withFallback((provider) => {
    const capable = provider as StatementProvider;
    if (typeof capable.getCashFlowStatements !== "function") {
      throw new MarketDataProviderError("Provider does not support cash-flow statements", {
        provider: provider.name,
        status: 501,
        code: "unsupported",
      });
    }
    return capable.getCashFlowStatements(symbol, query);
  });

export const getOptionsChain = (query: OptionsChainQuery) =>
  withFallback((provider) => provider.getOptionsChain(query));
export const getOptionContracts = (query: OptionContractQuery) =>
  withFallback((provider) => provider.getOptionContracts(query));
export const getOptionContract = (ticker: string) =>
  withFallback((provider) => provider.getOptionContract(ticker));
export const getOptionSnapshot = (query: OptionSnapshotQuery) =>
  withFallback((provider) => {
    if (!provider.getOptionSnapshot) {
      throw new MarketDataProviderError("Provider does not support option snapshots", {
        provider: provider.name,
        status: 501,
        code: "unsupported",
      });
    }
    return provider.getOptionSnapshot(query);
  });
export const getOptionAggregatesPage = (query: OptionAggregateQuery) =>
  withFallback((provider) => {
    if (!provider.getOptionAggregatesPage) {
      throw new MarketDataProviderError("Provider does not support option aggregates", {
        provider: provider.name,
        status: 501,
        code: "unsupported",
      });
    }
    return provider.getOptionAggregatesPage(query);
  });
export const getOptionAggregates = (query: OptionAggregateQuery) =>
  withFallback((provider) => {
    if (!provider.getOptionAggregates) {
      throw new MarketDataProviderError("Provider does not support option aggregates", {
        provider: provider.name,
        status: 501,
        code: "unsupported",
      });
    }
    return provider.getOptionAggregates(query);
  });
export const getCorporateEvents = (query: {
  ticker?: string;
  from?: string;
  to?: string;
  limit?: number;
}) => withFallback((provider) => provider.getCorporateEvents(query));
export const getTmxCorporateEvents = (query: {
  ticker?: string;
  from?: string;
  to?: string;
  limit?: number;
}) => withFallback((provider) => provider.getTmxCorporateEvents(query));

export type {
  AggregateBar,
  AggregatePage,
  AggregateQuery,
  CorporateEvent,
  FinancialRatio,
  FinancialRatios,
  FinancialRatiosQuery,
  HistoryPoint,
  MarketDataCapabilities,
  MarketDataProviderName,
  OptionContract,
  OptionContractQuery,
  OptionAggregateQuery,
  OptionSnapshot,
  OptionSnapshotQuery,
  OptionsChainQuery,
  ProviderPage,
} from "./types.js";
export { MarketDataProviderError } from "./types.js";
export type {
  CashFlowStatement,
  FinancialStatementPage,
  FinancialStatementQuery,
  IncomeStatement,
} from "./massive.js";
