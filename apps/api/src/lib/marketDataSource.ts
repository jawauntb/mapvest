import type { Source } from "@mapvest/core";
import { type MarketDataProviderName, getMarketDataCapabilities } from "@mapvest/finance";

export function marketDataSource(providerOverride?: MarketDataProviderName): Source {
  const provider = providerOverride ?? getMarketDataCapabilities().provider;
  return {
    provider,
    url: provider === "massive" ? "https://massive.com/docs" : "https://finance.yahoo.com",
    fetchedAt: new Date().toISOString(),
    confidence: provider === "massive" ? "high" : "medium",
  };
}
