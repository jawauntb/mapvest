/**
 * Shared constants used across routes and middleware.
 * Consolidates magic strings, timeouts, and configuration values
 * to reduce duplication and enable easier tuning.
 */

// Auth & Session
export const MAGIC_LINK_TTL_SEC = 10 * 60; // 10 minutes
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
export const ADMIN_TOKEN_PREFIX = "admin_";

// Rate Limiting & Throttling
export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
export const RATE_LIMIT_MAX_REQUESTS = 100;
export const RATE_LIMIT_BURST_SIZE = 20;

// Cache Control Headers
export const CACHE_SHORT = "public, max-age=15, stale-while-revalidate=60"; // 15s
export const CACHE_60S = "public, max-age=60, stale-while-revalidate=300"; // 60s
export const CACHE_120S = "public, max-age=120, stale-while-revalidate=300"; // 2m
export const CACHE_MEDIUM = "public, max-age=300, stale-while-revalidate=600"; // 5m
export const CACHE_MEDIUM_LONG = "public, max-age=300, stale-while-revalidate=900"; // 5m → 15m
export const CACHE_MEDIUM_VERY_LONG = "public, max-age=300, stale-while-revalidate=3600"; // 5m → 1h
export const CACHE_LONG = "public, max-age=3600, stale-while-revalidate=86400"; // 1h
export const CACHE_PRIVATE_60S = "private, max-age=60"; // private 60s
export const CACHE_NO_STORE = "no-store, must-revalidate";
export const CACHE_NO_CACHE = "no-cache, no-transform";

// Limits
export const MAX_TICKERS = 10;
export const MAX_DESCRIPTION_LENGTH = 1000;
export const MAX_TITLE_LENGTH = 200;
export const MAX_RESULTS = 100;

// Timeouts
export const DEFAULT_TIMEOUT_MS = 5000;
export const QUOTE_TIMEOUT_MS = 3000;
export const SEARCH_TIMEOUT_MS = 8000;
export const API_TIMEOUT_MS = 30_000;

// HTTP Status Codes (for clarity)
export const STATUS_OK = 200;
export const STATUS_CREATED = 201;
export const STATUS_BAD_REQUEST = 400;
export const STATUS_UNAUTHORIZED = 401;
export const STATUS_FORBIDDEN = 403;
export const STATUS_NOT_FOUND = 404;
export const STATUS_CONFLICT = 409;
export const STATUS_UNPROCESSABLE = 422;
export const STATUS_SERVER_ERROR = 500;
export const STATUS_BAD_GATEWAY = 502;
export const STATUS_SERVICE_UNAVAILABLE = 503;

// CORS Headers
export const CORS_ORIGINS = "*";
export const CORS_METHODS = ["GET", "POST", "DELETE", "OPTIONS"] as const;
export const CORS_HEADERS = [
  "Authorization",
  "Content-Type",
  "Accept",
  "X-Device-Id",
  "Idempotency-Key",
] as const;

// Sentinel values
export const DEFERRED_TO_V02 = "v0.2";
export const LINK_OUT_SUFFIX = " link-out — live sibling instance";
