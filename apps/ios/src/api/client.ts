import { API_URL } from "@/util/env";
import type {
  IdentifyResponse,
  NearbyResponse,
  ResolveComparableResponse,
  Session,
  User,
  LatLng,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

type FetchOpts = {
  token?: string;
  signal?: AbortSignal;
};

async function jsonFetch<T>(
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

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text || res.statusText);
  }
  return (await res.json()) as T;
}

// -------- auth --------

export function requestMagicLink(
  email: string,
): Promise<{ sent: true; devCode?: string }> {
  // v0.1: no SMTP wired, so the API returns { devCode } inline when
  // AUTH_RETURN_CODE=1. The auth screen surfaces it for demo submissions.
  return jsonFetch("/v1/auth/session", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function verifyMagicLink(
  email: string,
  code: string,
): Promise<{ session: Session; user: User }> {
  return jsonFetch("/v1/auth/session/verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export function getMe(token: string): Promise<{ user: User }> {
  return jsonFetch("/v1/auth/me", { method: "GET" }, { token });
}

// -------- nearby / identify / resolve --------

export function fetchNearby(
  args: { lat: number; lng: number; radius?: number; limit?: number },
  opts: FetchOpts = {},
): Promise<NearbyResponse> {
  const params = new URLSearchParams({
    lat: String(args.lat),
    lng: String(args.lng),
    radius: String(args.radius ?? 500),
    limit: String(args.limit ?? 25),
  });
  return jsonFetch(`/v1/nearby?${params.toString()}`, { method: "GET" }, opts);
}

/**
 * POST a captured photo to /v1/identify. `imageUri` is a local file:// URI
 * from expo-camera. We upload as multipart/form-data.
 */
export async function identifyPhoto(
  args: { imageUri: string; location?: LatLng },
  opts: FetchOpts = {},
): Promise<IdentifyResponse> {
  const form = new FormData();
  // React Native's FormData accepts { uri, name, type } as the file value.
  form.append("image", {
    // biome-ignore lint/suspicious/noExplicitAny: RN FormData file value shape
    uri: args.imageUri,
    name: "capture.jpg",
    type: "image/jpeg",
    // biome-ignore lint/suspicious/noExplicitAny: same
  } as any);
  if (args.location) {
    form.append("location", JSON.stringify(args.location));
  }
  const headers = new Headers();
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  headers.set("Accept", "application/json");
  // Let fetch set the multipart boundary itself; do NOT set Content-Type.

  const res = await fetch(`${API_URL}/v1/identify`, {
    method: "POST",
    body: form,
    headers,
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text || res.statusText);
  }
  return (await res.json()) as IdentifyResponse;
}

export function resolveComparable(
  args: { brand: string; hintSector?: string },
  opts: FetchOpts = {},
): Promise<ResolveComparableResponse> {
  return jsonFetch(
    "/v1/resolve-comparable",
    { method: "POST", body: JSON.stringify(args) },
    opts,
  );
}

// -------- memo + watchlist --------

export type WatchEntry = {
  ticker: string;
  name?: string;
  sector?: string;
  source: "camera" | "map" | "list" | "manual" | "detail";
  memo?: string;
  memoProvider?: string;
  createdAt: string;
};

export function generateMemo(
  ticker: string,
  opts: FetchOpts = {},
): Promise<{ ticker: string; provider: string; memo: string }> {
  return jsonFetch(
    "/v1/memo",
    { method: "POST", body: JSON.stringify({ ticker }) },
    opts,
  );
}

export function secFilings(
  ticker: string,
  opts: FetchOpts = {},
): Promise<{ CIK: string; Citations: Array<{ Form: string; Label: string; URL: string }> }> {
  return jsonFetch(`/v1/memo/sec/${ticker}`, { method: "GET" }, opts);
}

export function listWatchlist(opts: FetchOpts): Promise<{ items: WatchEntry[] }> {
  return jsonFetch("/v1/watchlist", { method: "GET" }, opts);
}

export function addToWatchlist(
  entry: Partial<WatchEntry> & { ticker: string },
  opts: FetchOpts,
): Promise<{ entry: WatchEntry }> {
  return jsonFetch(
    "/v1/watchlist/add",
    { method: "POST", body: JSON.stringify(entry) },
    opts,
  );
}

export function removeFromWatchlist(
  ticker: string,
  opts: FetchOpts,
): Promise<{ ok: true; removed: boolean }> {
  return jsonFetch(
    `/v1/watchlist/${ticker}`,
    { method: "DELETE" },
    opts,
  );
}

export function saveMemoToWatchlist(
  ticker: string,
  memo: string,
  provider: string | undefined,
  opts: FetchOpts,
): Promise<{ entry: WatchEntry }> {
  return jsonFetch(
    `/v1/watchlist/${ticker}/memo`,
    { method: "POST", body: JSON.stringify({ memo, provider }) },
    opts,
  );
}

// -------- admin --------

export function adminMetrics(opts: FetchOpts): Promise<{
  requests24h: number;
  identify24h: number;
  activeUsers: number;
}> {
  return jsonFetch("/v1/admin/metrics", { method: "GET" }, opts);
}
