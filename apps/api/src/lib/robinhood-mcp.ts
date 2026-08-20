import { createHash } from "node:crypto";
import { encryptSecret } from "./crypto-secret.js";
import { dbEnabled, getSql, initDb } from "./db.js";

/**
 * Per-user Robinhood MCP credentials.
 * Persisted encrypted in Postgres when POSTGRES_URL is set; otherwise in-memory.
 * Mapvest never places broker orders — "Open in Robinhood" deep-links to RH.
 */

export type RobinhoodMcpMeta = {
  fingerprint: string;
  last4: string;
  updatedAt: string;
  hasCredential: true;
};

const memory = new Map<string, { token: string; meta: RobinhoodMcpMeta }>();

export function fingerprintToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function metaFrom(token: string, updatedAt = new Date().toISOString()): RobinhoodMcpMeta {
  return {
    fingerprint: fingerprintToken(token),
    last4: token.slice(-4),
    updatedAt,
    hasCredential: true,
  };
}

export async function getRobinhoodMcp(userId: string): Promise<RobinhoodMcpMeta | undefined> {
  await initDb();
  const mem = memory.get(userId);
  if (mem) return mem.meta;

  if (!dbEnabled()) return undefined;
  const sql = getSql();
  if (!sql) return undefined;
  const rows = await sql`
    SELECT fingerprint, last4, updated_at, token_ciphertext
    FROM user_robinhood_mcp
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  const row = rows[0] as
    | {
        fingerprint: string;
        last4: string;
        updated_at: Date | string;
        token_ciphertext: string;
      }
    | undefined;
  if (!row) return undefined;
  const updatedAt =
    typeof row.updated_at === "string" ? row.updated_at : row.updated_at.toISOString();
  const meta: RobinhoodMcpMeta = {
    fingerprint: row.fingerprint,
    last4: row.last4,
    updatedAt,
    hasCredential: true,
  };
  // Keep ciphertext in memory as opaque — we don't need plaintext for open-link.
  memory.set(userId, { token: row.token_ciphertext, meta });
  return meta;
}

export async function hasRobinhoodMcp(userId: string): Promise<boolean> {
  return Boolean(await getRobinhoodMcp(userId));
}

export async function setRobinhoodMcp(userId: string, token: string): Promise<RobinhoodMcpMeta> {
  await initDb();
  const meta = metaFrom(token);
  memory.set(userId, { token, meta });

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const ciphertext = encryptSecret(token);
      const updated = new Date(meta.updatedAt);
      await sql`
        INSERT INTO user_robinhood_mcp (user_id, token_ciphertext, fingerprint, last4, updated_at)
        VALUES (${userId}, ${ciphertext}, ${meta.fingerprint}, ${meta.last4}, ${updated})
        ON CONFLICT (user_id) DO UPDATE SET
          token_ciphertext = EXCLUDED.token_ciphertext,
          fingerprint = EXCLUDED.fingerprint,
          last4 = EXCLUDED.last4,
          updated_at = EXCLUDED.updated_at
      `;
    }
  }
  return meta;
}

export async function clearRobinhoodMcp(userId: string): Promise<void> {
  await initDb();
  memory.delete(userId);
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      await sql`DELETE FROM user_robinhood_mcp WHERE user_id = ${userId}`;
    }
  }
}

/** Public Robinhood stock page (opens app via Universal Link when installed). */
export function robinhoodStockUrl(ticker: string): string {
  const sym = ticker.trim().toUpperCase();
  return `https://robinhood.com/us/en/stocks/${encodeURIComponent(sym)}/`;
}
