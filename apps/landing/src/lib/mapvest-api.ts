/**
 * Browser client for the Mapvest API. Runs entirely client-side; the session
 * token lives in localStorage. CORS is open on the API (see apps/api).
 */

export const API_URL =
  process.env.NEXT_PUBLIC_MAPVEST_API_URL ??
  "https://api-production-4b27.up.railway.app";

const TOKEN_KEY = "mapvest.session.token";
const USER_KEY = "mapvest.session.user";

export type User = {
  id: string;
  email: string;
  createdAt: string;
  scopes: Array<"user" | "admin">;
};

export type Session = { token: string; userId: string; expiresAt: string };

export type NearbyItem = {
  place: {
    id: string;
    name: string;
    location: { lat: number; lng: number };
    types: string[];
  };
  investable?: {
    brand: {
      name: string;
      isPublic: boolean;
      ticker?: { symbol: string; exchange?: string };
      sector?: string;
    };
    confidence: "high" | "medium" | "low";
  };
};

export type WatchEntry = {
  ticker: string;
  name?: string;
  sector?: string;
  source: "camera" | "map" | "list" | "manual" | "detail" | "web";
  memo?: string;
  memoProvider?: string;
  createdAt: string;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(
  path: string,
  init: RequestInit = {},
  needsAuth = false,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (needsAuth) {
    if (!token) throw new ApiError(401, "not signed in");
    headers.set("Authorization", `Bearer ${token}`);
  } else if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
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

// ---- storage ----

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setSession(session: Session, user: User) {
  window.localStorage.setItem(TOKEN_KEY, session.token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

// ---- auth ----

export function requestCode(email: string) {
  return req<{ sent: true; devCode?: string }>("/v1/auth/session", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function verifyCode(email: string, code: string) {
  return req<{ session: Session; user: User }>("/v1/auth/session/verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

// ---- nearby / resolve ----

export function fetchNearby(lat: number, lng: number, radius = 500, limit = 25) {
  return req<{ items: NearbyItem[] }>(
    `/v1/nearby?lat=${lat}&lng=${lng}&radius=${radius}&limit=${limit}`,
  );
}

export function resolveComparable(brand: string, hintSector?: string) {
  return req<{
    brand: NearbyItem["investable"] extends { brand: infer B } ? B : never;
    comparables: Array<{
      ticker: string;
      name: string;
      score: number;
      reasoning: string;
      sources: Array<{ provider: string; url?: string; confidence: string }>;
    }>;
    etfs: Array<{
      ticker: string;
      name: string;
      weight: number;
      source: { provider: string; url?: string };
    }>;
  }>("/v1/resolve-comparable", {
    method: "POST",
    body: JSON.stringify({ brand, hintSector }),
  });
}

export function getQuote(symbol: string) {
  return req<{
    quote?: {
      symbol: string;
      price: number;
      change: number;
      changePct: number;
      currency: string;
      ts: string;
      disclaimer: string;
    };
  }>(`/v1/quote?symbol=${encodeURIComponent(symbol)}`);
}

// ---- identify ----

export async function identifyImage(file: File, location?: { lat: number; lng: number }) {
  const form = new FormData();
  form.append("image", file);
  if (location) {
    form.append("lat", String(location.lat));
    form.append("lng", String(location.lng));
  }
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}/v1/identify`, {
    method: "POST",
    body: form,
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let message = text || res.statusText;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (typeof j.error === "string" && j.error.trim()) message = j.error;
    } catch {
      /* plain-text body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as {
    identification: {
      visibleText: string[];
      detected: Array<{
        brand?: string;
        product?: string;
        sector?: string;
        confidence: "high" | "medium" | "low";
      }>;
      modelUsed: string;
    };
    investables: Array<{
      brand: {
        name: string;
        isPublic: boolean;
        ticker?: { symbol: string; exchange?: string };
        sector?: string;
      };
      comparables?: Array<{ ticker: string; name?: string; score?: number }>;
      confidence: "high" | "medium" | "low";
    }>;
  };
}

// ---- memo + watchlist ----

export function generateMemo(ticker: string) {
  return req<{ ticker: string; provider: string; memo: string }>("/v1/memo", {
    method: "POST",
    body: JSON.stringify({ ticker }),
  });
}

export function listWatchlist() {
  return req<{ items: WatchEntry[] }>("/v1/watchlist", {}, true);
}

export function addToWatchlist(entry: Partial<WatchEntry> & { ticker: string }) {
  return req<{ entry: WatchEntry }>(
    "/v1/watchlist/add",
    { method: "POST", body: JSON.stringify(entry) },
    true,
  );
}

export function removeFromWatchlist(ticker: string) {
  return req<{ ok: true; removed: boolean }>(
    `/v1/watchlist/${ticker}`,
    { method: "DELETE" },
    true,
  );
}

export function saveMemoToWatchlist(ticker: string, memo: string, provider: string | undefined) {
  return req<{ entry: WatchEntry }>(
    `/v1/watchlist/${ticker}/memo`,
    { method: "POST", body: JSON.stringify({ memo, provider }) },
    true,
  );
}
