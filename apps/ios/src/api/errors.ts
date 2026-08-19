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
