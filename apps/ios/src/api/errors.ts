/**
 * Shared API error shape. `jsonFetch` / `apiFetch` / multipart identify all
 * throw this so a 402 `quota_exceeded` is distinguishable from a generic
 * failure (camera used to enqueue those as "offline").
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public remaining?: number,
    public limit?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isQuotaExceeded(): boolean {
    return this.status === 402 && this.code === "quota_exceeded";
  }
}

export function isQuotaExceeded(err: unknown): err is ApiError {
  return err instanceof ApiError && err.isQuotaExceeded;
}

const DEFAULT_RESEARCH_ERROR = "Research couldn’t finish. Try again.";
const RESEARCH_NETWORK_ERROR = "Couldn’t connect to research. Check your connection and try again.";
const RESEARCH_SERVER_ERROR = "Research is temporarily unavailable. Try again.";
const RESEARCH_AUTH_ERROR = "Research access is temporarily unavailable. Try again shortly.";

/**
 * Research responses can carry provider/status codes as the `error` string.
 * Those are useful for logs, but not for a person reading the app. Keep this
 * deliberately conservative: standalone separator-delimited identifiers and
 * underscore-delimited tokens in prose are hidden, while ordinary prose is
 * returned unchanged.
 */
function looksLikeMachineCode(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  return (
    /^[A-Za-z][A-Za-z0-9]*(?:[_.-][A-Za-z0-9]+)+$/.test(normalized) ||
    /(?:^|[^A-Za-z0-9])(?:[A-Za-z][A-Za-z0-9]*_)+[A-Za-z0-9]+(?=$|[^A-Za-z0-9])/.test(normalized)
  );
}

function isUpstreamAuthFailure(value: string): boolean {
  return /(?:upstream[^\n]*(?:401|403)|(?:401|403)[^\n]*upstream|upstream[ _-]*(?:auth|authentication|authorization)|unauthori[sz]ed|forbidden|(?:auth|authentication|authorization)[ _-]*(?:failed|failure|denied|error|required)|access[ _-]*(?:denied|error|required|forbidden))/i.test(
    value,
  );
}

function isNetworkFailure(value: string): boolean {
  return /(?:network|offline|internet|failed to fetch|fetch failed|timed? ?out|connection (?:reset|lost|closed|failed))/i.test(
    value,
  );
}

function isServerFailureCode(value: string): boolean {
  return /(?:upstream|research)[ _-]*5\d\d|(?:research|service)[ _-]*(?:failed|unavailable|error)/i.test(
    value,
  );
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  return "";
}

/**
 * Convert a research failure into copy safe for a person to see.
 *
 * This is intentionally pure so article.error strings and thrown transport
 * errors use exactly the same rules in every research surface.
 */
export function formatResearchError(error: unknown, fallback = DEFAULT_RESEARCH_ERROR): string {
  const message = errorMessage(error);
  const code = error instanceof ApiError ? (error.code?.trim() ?? "") : "";
  const status = error instanceof ApiError ? error.status : undefined;

  if (
    status === 401 ||
    status === 403 ||
    isUpstreamAuthFailure(code) ||
    isUpstreamAuthFailure(message)
  ) {
    return RESEARCH_AUTH_ERROR;
  }
  if (status != null && status >= 500) return RESEARCH_SERVER_ERROR;
  if (isServerFailureCode(code) || isServerFailureCode(message)) return RESEARCH_SERVER_ERROR;
  if (isNetworkFailure(message)) return RESEARCH_NETWORK_ERROR;
  if (looksLikeMachineCode(message)) return fallback.trim() || DEFAULT_RESEARCH_ERROR;
  return message || fallback.trim() || DEFAULT_RESEARCH_ERROR;
}

export function apiErrorFromResponse(status: number, text: string, fallback: string): ApiError {
  let message = text || fallback;
  let code: string | undefined;
  let remaining: number | undefined;
  let limit: number | undefined;
  try {
    const j = JSON.parse(text) as {
      error?: string;
      code?: string;
      remaining?: number;
      limit?: number;
    };
    if (typeof j.error === "string" && j.error.trim()) message = j.error;
    if (typeof j.code === "string") code = j.code;
    if (typeof j.remaining === "number") remaining = j.remaining;
    if (typeof j.limit === "number") limit = j.limit;
  } catch {
    /* plain-text body */
  }
  return new ApiError(status, message, code, remaining, limit);
}

/** React Query retry: one retry, never on 429 / 401 (retrying those deepens the hole). */
export function shouldRetryQuery(failureCount: number, error: unknown, max = 1): boolean {
  if (error instanceof ApiError && (error.status === 429 || error.status === 401)) return false;
  return failureCount < max;
}
