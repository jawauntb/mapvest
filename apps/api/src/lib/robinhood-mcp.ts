import { createHash } from "node:crypto";

/**
 * Per-user Robinhood MCP credentials (server-side only).
 * Mapvest never places broker orders — "Open in Robinhood" deep-links to RH.
 */

export type RobinhoodMcpMeta = {
  fingerprint: string;
  last4: string;
  updatedAt: string;
  hasCredential: true;
};

const robinhoodByUser = new Map<string, { token: string; meta: RobinhoodMcpMeta }>();

export function fingerprintToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export function getRobinhoodMcp(userId: string): RobinhoodMcpMeta | undefined {
  return robinhoodByUser.get(userId)?.meta;
}

export function hasRobinhoodMcp(userId: string): boolean {
  return robinhoodByUser.has(userId);
}

export function setRobinhoodMcp(userId: string, token: string): RobinhoodMcpMeta {
  const meta: RobinhoodMcpMeta = {
    fingerprint: fingerprintToken(token),
    last4: token.slice(-4),
    updatedAt: new Date().toISOString(),
    hasCredential: true,
  };
  robinhoodByUser.set(userId, { token, meta });
  return meta;
}

export function clearRobinhoodMcp(userId: string): void {
  robinhoodByUser.delete(userId);
}

/** Public Robinhood stock page (opens app via Universal Link when installed). */
export function robinhoodStockUrl(ticker: string): string {
  const sym = ticker.trim().toUpperCase();
  return `https://robinhood.com/us/en/stocks/${encodeURIComponent(sym)}/`;
}
