import { massiveClient } from "./massive.js";
import type {
  AggregateBar,
  AggregatePage,
  AggregateQuery,
  CorporateEvent,
  HistoryPoint,
  MarketDataCapabilities,
  MarketDataProvider,
  MarketDataProviderName,
  OptionContract,
  OptionContractQuery,
  OptionSnapshot,
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
export const getHistoricalCloses = (symbol: string, period: "1mo" | "3mo" | "6mo" | "1y") =>
  withNullableFallback((provider) => provider.getHistoricalCloses(symbol, period));
export const getHistoricalClosesWithProvider = (
  symbol: string,
  period: "1mo" | "3mo" | "6mo" | "1y",
) => withNullableFallbackProvider((provider) => provider.getHistoricalCloses(symbol, period));
export const getAggregates = (query: AggregateQuery) =>
  withFallback((provider) => provider.getAggregates(query));
export const getAggregatesPage = (query: AggregateQuery) =>
  withFallback((provider) => provider.getAggregatesPage(query));
export const getOptionsChain = (query: OptionsChainQuery) =>
  withFallback((provider) => provider.getOptionsChain(query));
export const getOptionContracts = (query: OptionContractQuery) =>
  withFallback((provider) => provider.getOptionContracts(query));
export const getOptionContract = (ticker: string) =>
  withFallback((provider) => provider.getOptionContract(ticker));
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
  HistoryPoint,
  MarketDataCapabilities,
  MarketDataProviderName,
  OptionContract,
  OptionContractQuery,
  OptionSnapshot,
  OptionsChainQuery,
  ProviderPage,
} from "./types.js";
export { MarketDataProviderError } from "./types.js";
