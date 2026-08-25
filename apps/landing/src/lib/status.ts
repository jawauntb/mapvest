/**
 * Live status probe against the production API.
 *
 * Called from two places:
 *   - The /api/status route handler (runtime-ish, though the route is
 *     cached — see route.ts for the caching policy).
 *   - The homepage server component at build time, so we can render
 *     "System status" without any client-side JS.
 *
 * The probe MUST NOT throw. Every failure mode collapses into
 * { api: "down", checkedAt } so the site always builds.
 */

export type ApiState = "up" | "down" | "unknown";

export type ApiStatus = {
  api: ApiState;
  checkedAt: string; // ISO timestamp of when we probed
};

// Live API base URL. Overridable via env for local/staging targeting, but
// defaults to the production Railway deploy so a fresh clone probes the
// same host the docs point at.
const API_BASE = process.env.MAPVEST_API_BASE_URL || "https://api-production-4b27.up.railway.app";

const PROBE_TIMEOUT_MS = 2000;

/**
 * Hit /v1/health with a 2s timeout. Any non-2xx, network error, or
 * timeout is treated as "down". The build must never fail because of
 * this — callers can also treat this as "unknown" by inspecting the
 * result.
 */
export async function probeApi(): Promise<ApiStatus> {
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}/v1/health`, {
      method: "GET",
      signal: controller.signal,
      // Bypass Next's fetch cache — we want a fresh probe each build.
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      return { api: "down", checkedAt };
    }
    return { api: "up", checkedAt };
  } catch {
    return { api: "down", checkedAt };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Safe wrapper: returns { api: "unknown", checkedAt } if the probe
 * itself throws for some pathological reason (it shouldn't — probeApi
 * already swallows every error — but static builds must be bulletproof).
 */
export async function probeApiSafe(): Promise<ApiStatus> {
  try {
    return await probeApi();
  } catch {
    return { api: "unknown", checkedAt: new Date().toISOString() };
  }
}
