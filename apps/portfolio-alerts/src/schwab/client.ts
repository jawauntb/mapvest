import { z } from "zod";

export const SCHWAB_BASE_URL = "https://api.schwabapi.com";
export const TOKEN_URL = `${SCHWAB_BASE_URL}/v1/oauth/token`;
export const AUTHORIZE_URL = `${SCHWAB_BASE_URL}/v1/oauth/authorize`;
// Schwab refresh tokens hard-expire 7 days after the browser login that minted them.
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Schwab's OAuth has no read-only scope, so read-only is enforced here: the client
// only issues GET, and only to these paths. Nothing in this app can place, replace,
// or cancel an order.
const READ_ONLY_PATHS = [
  /^\/trader\/v1\/accounts\/accountNumbers$/,
  /^\/trader\/v1\/accounts\/[A-Za-z0-9]+$/,
  /^\/marketdata\/v1\/pricehistory$/,
];

export class SchwabAuthError extends Error {
  readonly needsReauth = true;
}

export class SchwabApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

async function postToken(
  body: URLSearchParams,
  creds: { appKey: string; appSecret: string },
  fetchImpl: Fetch,
): Promise<TokenResponse> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${creds.appKey}:${creds.appSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (res.status === 400 || res.status === 401) {
    // Expired or revoked refresh token, or a stale auth code. Only a browser login fixes it.
    const detail = await res.text().catch(() => "");
    throw new SchwabAuthError(`Schwab rejected the token request (${res.status}): ${detail}`);
  }
  if (!res.ok) throw new SchwabApiError(`Schwab token endpoint ${res.status}`, res.status);
  return tokenResponseSchema.parse(await res.json());
}

export function refreshAccessToken(
  creds: { appKey: string; appSecret: string; refreshToken: string },
  fetchImpl: Fetch = fetch,
): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: creds.refreshToken }),
    creds,
    fetchImpl,
  );
}

export function exchangeAuthCode(
  creds: { appKey: string; appSecret: string; code: string; redirectUri: string },
  fetchImpl: Fetch = fetch,
): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: creds.code,
      redirect_uri: creds.redirectUri,
    }),
    creds,
    fetchImpl,
  );
}

export function authorizeUrl(appKey: string, redirectUri: string): string {
  const params = new URLSearchParams({ client_id: appKey, redirect_uri: redirectUri });
  return `${AUTHORIZE_URL}?${params}`;
}

// ---- response shapes (only the fields this app reads; everything else passes through) ----

const num = z.number().optional();

const positionSchema = z
  .object({
    longQuantity: num,
    shortQuantity: num,
    previousSessionLongQuantity: num,
    previousSessionShortQuantity: num,
    marketValue: num,
    instrument: z
      .object({
        symbol: z.string(),
        assetType: z.string().optional(),
        description: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const balancesSchema = z.object({ liquidationValue: num }).passthrough();

export const accountResponseSchema = z
  .object({
    securitiesAccount: z
      .object({
        accountNumber: z.string().optional(),
        type: z.string().optional(),
        positions: z.array(positionSchema).optional(),
        initialBalances: balancesSchema.optional(),
        currentBalances: balancesSchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type AccountResponse = z.infer<typeof accountResponseSchema>;

export const accountNumbersSchema = z.array(
  z.object({ accountNumber: z.string(), hashValue: z.string() }),
);

export const priceHistorySchema = z
  .object({
    symbol: z.string().optional(),
    empty: z.boolean().optional(),
    candles: z.array(
      z
        .object({
          open: num,
          high: num,
          low: num,
          close: z.number(),
          volume: num,
          datetime: z.number(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type PriceHistoryResponse = z.infer<typeof priceHistorySchema>;

export class SchwabReadOnlyClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async get<T>(
    path: string,
    query: Record<string, string>,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ) {
    if (!READ_ONLY_PATHS.some((re) => re.test(path))) {
      throw new Error(`Refusing non-allowlisted Schwab path: ${path}`);
    }
    const url = new URL(path, SCHWAB_BASE_URL);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" },
    });
    if (res.status === 401) throw new SchwabAuthError(`Schwab ${path} returned 401`);
    if (!res.ok) throw new SchwabApiError(`Schwab ${path} returned ${res.status}`, res.status);
    return schema.parse(await res.json());
  }

  accountNumbers() {
    return this.get("/trader/v1/accounts/accountNumbers", {}, accountNumbersSchema);
  }

  account(hash: string) {
    return this.get(`/trader/v1/accounts/${hash}`, { fields: "positions" }, accountResponseSchema);
  }

  dailyHistory(symbol: string) {
    return this.get(
      "/marketdata/v1/pricehistory",
      { symbol, periodType: "year", period: "1", frequencyType: "daily", frequency: "1" },
      priceHistorySchema,
    );
  }
}

export const maskAccountNumber = (n: string | undefined) => (n ? `…${n.slice(-4)}` : "…????");
