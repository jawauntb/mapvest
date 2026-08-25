/**
 * Server-only Derivation Research Console boundary.
 *
 * The unified conversation API uses the mutate-capable service credential and
 * retains the forwarded-host attestation required by older Console deployments.
 */

const DEFAULT_DERIVATION_FORWARDED_HOST = "derivation-research-jawaun.jtbx.workers.dev";

function configuredOrigin(): string | undefined {
  const value =
    process.env.DERIVATION_RESEARCH_API_ORIGIN?.trim() || process.env.DERIVATION_URL?.trim();
  return value ? value.replace(/\/+$/, "") : undefined;
}

function configuredServiceToken(): string | undefined {
  return (
    process.env.DERIVATION_RESEARCH_SERVICE_TOKEN?.trim() ||
    process.env.RESEARCH_CONSOLE_SERVICE_TOKEN_MUTATE?.trim() ||
    process.env.RESEARCH_CONSOLE_SERVICE_TOKEN_READ?.trim() ||
    undefined
  );
}

function forwardedHost(): string {
  return process.env.RESEARCH_CONSOLE_FORWARDED_HOST?.trim() || DEFAULT_DERIVATION_FORWARDED_HOST;
}

export class DerivationConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DerivationConfigurationError";
  }
}

export function getDerivationOrigin(): string {
  const origin = configuredOrigin();
  if (!origin) {
    throw new DerivationConfigurationError(
      "DERIVATION_RESEARCH_API_ORIGIN (or legacy DERIVATION_URL) is required",
    );
  }

  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
  } catch {
    throw new DerivationConfigurationError("Derivation Research Console origin must be HTTP(S)");
  }

  return origin;
}

function requireServiceToken(): string {
  const token = configuredServiceToken();
  if (!token) {
    throw new DerivationConfigurationError(
      "DERIVATION_RESEARCH_SERVICE_TOKEN (or a legacy Console service token) is required",
    );
  }
  return token;
}

function attestationHeaders(token: string): Record<string, string> {
  const host = forwardedHost();
  return {
    "x-research-console-forwarded-host": host,
    "x-forwarded-proto": "https",
    Origin: `https://${host}`,
    Authorization: `Bearer ${token}`,
  };
}

export type DerivationResearchDepth = "auto" | "instant" | "standard" | "deep" | "max";

type DerivationExploreRequestBase = Readonly<{
  prompt: string;
  mode: "agent";
  research_depth: DerivationResearchDepth;
  client_message_id: string;
}>;

export type DerivationExploreRequest = DerivationExploreRequestBase &
  (
    | Readonly<{
        conversation_id?: never;
        message_mode?: never;
      }>
    | Readonly<{
        conversation_id: string;
        message_mode: "steer";
      }>
  );

export type DerivationConversationStatus =
  | "queued"
  | "running"
  | "conclusive"
  | "exhausted"
  | "blocked"
  | "error";

export type DerivationCanonicalConversation = Readonly<{
  schema_version: "research_conversation_ref_v1";
  id: string;
  conversation_id: string;
  status: DerivationConversationStatus;
  deliverable: "ideas" | "memo";
  href: string;
  stream_href: string;
  pdf_url: string | null;
}>;

export type DerivationLegacyCampaign = Readonly<{
  id: string;
  status: DerivationConversationStatus;
  deliverable: "ideas" | "memo";
  href: string;
  pdf_url?: string | null;
}>;

export type DerivationConversation = DerivationCanonicalConversation | DerivationLegacyCampaign;

export type DerivationResponse = {
  conversation?: DerivationConversation;
  campaign?: DerivationLegacyCampaign;
  [key: string]: unknown;
};

export type DerivationExploreResponse = DerivationResponse & {
  mode?: "agent" | "blocked";
  prompt?: string;
  error?: unknown;
};

export type DerivationAutoresearchResponse = DerivationResponse & {
  conversation_id?: string;
  active?: boolean;
};

function isConversation(value: unknown): value is DerivationConversation {
  return Boolean(
    value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string",
  );
}

/** Prefer the neutral conversation object, falling back to the exact legacy campaign object. */
export function normalizeDerivationResponse<T extends DerivationResponse>(
  response: T,
): T & { conversation?: DerivationConversation } {
  const conversation = isConversation(response.conversation)
    ? response.conversation
    : isConversation(response.campaign)
      ? response.campaign
      : undefined;

  return conversation ? { ...response, conversation } : response;
}

export class DerivationUpstreamError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Derivation Research Console request failed (${status})`);
    this.name = "DerivationUpstreamError";
    this.status = status;
    this.body = body;
  }
}

type DerivationFetchOptions = Readonly<{
  fetch?: typeof fetch;
  signal?: AbortSignal;
}>;

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestJson(
  url: URL,
  init: RequestInit,
  options: DerivationFetchOptions,
): Promise<DerivationResponse> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const response = await fetcher(url, {
    ...init,
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });
  const body = await responseBody(response);
  if (!response.ok) throw new DerivationUpstreamError(response.status, body);
  return body as DerivationResponse;
}

function unifiedJsonHeaders(contentType = false): HeadersInit {
  return {
    Accept: "application/json",
    ...(contentType ? { "Content-Type": "application/json" } : {}),
    ...attestationHeaders(requireServiceToken()),
  };
}

export async function exploreDerivation(
  request: DerivationExploreRequest,
  options: DerivationFetchOptions = {},
): Promise<DerivationExploreResponse> {
  const url = new URL("/api/explore", getDerivationOrigin());
  const response = await requestJson(
    url,
    {
      method: "POST",
      headers: unifiedJsonHeaders(true),
      body: JSON.stringify(request),
    },
    options,
  );
  return normalizeDerivationResponse(response) as DerivationExploreResponse;
}

export type DerivationAutoresearchProjection = "summary" | "display";

export async function getDerivationAutoresearch(
  conversationId: string,
  projection: DerivationAutoresearchProjection,
  options: DerivationFetchOptions = {},
): Promise<DerivationAutoresearchResponse> {
  const url = new URL("/api/autoresearch", getDerivationOrigin());
  url.searchParams.set("conversation_id", conversationId);
  url.searchParams.set(projection, "1");
  const response = await requestJson(
    url,
    {
      method: "GET",
      headers: unifiedJsonHeaders(),
    },
    options,
  );
  return normalizeDerivationResponse(response) as DerivationAutoresearchResponse;
}
