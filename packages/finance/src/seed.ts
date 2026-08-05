/**
 * Seed brand → ticker map. Hand-vetted, add-only.
 * When adding, include a source URL in the commit message.
 */

export type SeedEntry = {
  ticker: string;
  exchange: string;
  parent: string;
  sector?: string;
  isPublic: true;
};

export const seedBrands: Record<string, SeedEntry> = {
  "mcdonald's": { ticker: "MCD", exchange: "NYSE", parent: "McDonald's Corp", sector: "Consumer Discretionary", isPublic: true },
  mcdonalds:    { ticker: "MCD", exchange: "NYSE", parent: "McDonald's Corp", sector: "Consumer Discretionary", isPublic: true },
  starbucks:    { ticker: "SBUX", exchange: "NASDAQ", parent: "Starbucks Corp", sector: "Consumer Discretionary", isPublic: true },
  "hershey's":  { ticker: "HSY", exchange: "NYSE", parent: "The Hershey Company", sector: "Consumer Staples", isPublic: true },
  hersheys:     { ticker: "HSY", exchange: "NYSE", parent: "The Hershey Company", sector: "Consumer Staples", isPublic: true },
  walmart:      { ticker: "WMT", exchange: "NYSE", parent: "Walmart Inc", sector: "Consumer Staples", isPublic: true },
  target:       { ticker: "TGT", exchange: "NYSE", parent: "Target Corp", sector: "Consumer Staples", isPublic: true },
  "coca-cola":  { ticker: "KO", exchange: "NYSE", parent: "The Coca-Cola Co", sector: "Consumer Staples", isPublic: true },
  coke:         { ticker: "KO", exchange: "NYSE", parent: "The Coca-Cola Co", sector: "Consumer Staples", isPublic: true },
  pepsi:        { ticker: "PEP", exchange: "NASDAQ", parent: "PepsiCo Inc", sector: "Consumer Staples", isPublic: true },
  nike:         { ticker: "NKE", exchange: "NYSE", parent: "Nike Inc", sector: "Consumer Discretionary", isPublic: true },
  adidas:       { ticker: "ADDYY", exchange: "OTC", parent: "Adidas AG", sector: "Consumer Discretionary", isPublic: true },
  apple:        { ticker: "AAPL", exchange: "NASDAQ", parent: "Apple Inc", sector: "Information Technology", isPublic: true },
  microsoft:    { ticker: "MSFT", exchange: "NASDAQ", parent: "Microsoft Corp", sector: "Information Technology", isPublic: true },
  google:       { ticker: "GOOGL", exchange: "NASDAQ", parent: "Alphabet Inc", sector: "Communication Services", isPublic: true },
  amazon:       { ticker: "AMZN", exchange: "NASDAQ", parent: "Amazon.com Inc", sector: "Consumer Discretionary", isPublic: true },
  netflix:      { ticker: "NFLX", exchange: "NASDAQ", parent: "Netflix Inc", sector: "Communication Services", isPublic: true },
  tesla:        { ticker: "TSLA", exchange: "NASDAQ", parent: "Tesla Inc", sector: "Consumer Discretionary", isPublic: true },
  ford:         { ticker: "F", exchange: "NYSE", parent: "Ford Motor Co", sector: "Consumer Discretionary", isPublic: true },
  gm:           { ticker: "GM", exchange: "NYSE", parent: "General Motors Co", sector: "Consumer Discretionary", isPublic: true },
  "chevron":    { ticker: "CVX", exchange: "NYSE", parent: "Chevron Corp", sector: "Energy", isPublic: true },
  "exxon":      { ticker: "XOM", exchange: "NYSE", parent: "Exxon Mobil Corp", sector: "Energy", isPublic: true },
  "shell":      { ticker: "SHEL", exchange: "NYSE", parent: "Shell plc", sector: "Energy", isPublic: true },
  "cvs":        { ticker: "CVS", exchange: "NYSE", parent: "CVS Health Corp", sector: "Health Care", isPublic: true },
  walgreens:    { ticker: "WBA", exchange: "NASDAQ", parent: "Walgreens Boots Alliance", sector: "Consumer Staples", isPublic: true },
  "home depot": { ticker: "HD", exchange: "NYSE", parent: "The Home Depot Inc", sector: "Consumer Discretionary", isPublic: true },
  lowes:        { ticker: "LOW", exchange: "NYSE", parent: "Lowe's Cos Inc", sector: "Consumer Discretionary", isPublic: true },
  "best buy":   { ticker: "BBY", exchange: "NYSE", parent: "Best Buy Co Inc", sector: "Consumer Discretionary", isPublic: true },
  costco:       { ticker: "COST", exchange: "NASDAQ", parent: "Costco Wholesale Corp", sector: "Consumer Staples", isPublic: true },
  fedex:        { ticker: "FDX", exchange: "NYSE", parent: "FedEx Corp", sector: "Industrials", isPublic: true },
  ups:          { ticker: "UPS", exchange: "NYSE", parent: "United Parcel Service Inc", sector: "Industrials", isPublic: true },
  visa:         { ticker: "V", exchange: "NYSE", parent: "Visa Inc", sector: "Financials", isPublic: true },
  mastercard:   { ticker: "MA", exchange: "NYSE", parent: "Mastercard Inc", sector: "Financials", isPublic: true },
  chase:        { ticker: "JPM", exchange: "NYSE", parent: "JPMorgan Chase & Co", sector: "Financials", isPublic: true },
  "wells fargo":{ ticker: "WFC", exchange: "NYSE", parent: "Wells Fargo & Co", sector: "Financials", isPublic: true },
  boa:          { ticker: "BAC", exchange: "NYSE", parent: "Bank of America Corp", sector: "Financials", isPublic: true },
};

/** Normalize a brand string to the seed key form. */
export function normalizeBrand(input: string): string {
  return input.trim().toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ");
}
