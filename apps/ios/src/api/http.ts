/**
 * Minimal shared fetcher used by feature-specific API modules that don't want
 * to pull in the full `./client.ts` surface. Mirrors the `jsonFetch` behavior
 * from client.ts (Bearer + X-Device-Id + JSON body/error handling) — keep the
 * two in shape-lockstep. This exists so new features can add clients without
 * churning `client.ts`.
 */
import { getDeviceId } from "@/util/deviceId";
import { API_URL } from "@/util/env";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type FetchOpts = {
  token?: string;
  signal?: AbortSignal;
};

export async function apiFetch<T>(
  path: string,
  init: RequestInit,
  opts: FetchOpts = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  try {
    headers.set("X-Device-Id", await getDeviceId());
  } catch {
    /* SecureStore unavailable — request proceeds without device id */
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    signal: opts.signal,
  });

  // Some endpoints (DELETE) return 204 with no body.
  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text || res.statusText;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (typeof j.error === "string" && j.error.trim()) message = j.error;
    } catch {
      /* plain-text body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}
