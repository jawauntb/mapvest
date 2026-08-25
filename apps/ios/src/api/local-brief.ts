/**
 * Client for /v1/local-brief (3-paragraph Local Economy Brief) + the saved-
 * locations folder. Feature-scoped — uses the shared `apiFetch` helper from
 * `./http.ts` rather than the legacy `./client.ts` surface, matching the
 * pattern established for alerts / news / backtest clients.
 */
import { type FetchOpts, apiFetch } from "./http";

export type LocalBriefPlace = {
  neighborhood?: string;
  city?: string;
  state?: string;
  zip?: string;
};

export type LocalBriefResponse = {
  /**
   * 3 paragraphs today; the server may return 4 in future — always render
   * whatever is here. Paragraph 3 may embed inline `Tailwinds:`, `Headwinds:`,
   * `Opportunities:`, `Challenges:` label lines separated by `\n`; render
   * paragraphs as-is (line breaks intentional).
   */
  paragraphs: string[];
  place: LocalBriefPlace;
  nearbyCount: number;
  generatedAt: string;
};

export type SavedLocalBrief = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  city?: string;
  state?: string;
  zip?: string;
  brief: string;
  createdAt: string;
};

/**
 * POST /v1/local-brief — generate (or cache-serve) the brief for the given
 * coordinates. `city`/`state`/`zip` are optional overrides; when omitted the
 * server reverse-geocodes via Nominatim.
 */
export function fetchLocalBrief(
  input: { lat: number; lng: number; city?: string; state?: string; zip?: string },
  opts: FetchOpts = {},
): Promise<LocalBriefResponse> {
  return apiFetch<LocalBriefResponse>(
    "/v1/local-brief",
    { method: "POST", body: JSON.stringify(input) },
    opts,
  );
}

/**
 * POST /v1/local-brief/save — persist a brief to the user's "Location folder".
 * The client supplies the label (user-facing) and the frozen brief text so
 * the saved entry doesn't drift if the generator prompt changes later.
 */
export function saveLocalBrief(
  input: {
    label: string;
    lat: number;
    lng: number;
    brief: string;
    place?: LocalBriefPlace;
  },
  opts: FetchOpts = {},
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(
    "/v1/local-brief/save",
    { method: "POST", body: JSON.stringify(input) },
    opts,
  );
}

/** GET /v1/local-brief/saved — every brief this user has stashed. */
export function listSavedLocalBriefs(opts: FetchOpts = {}): Promise<{ items: SavedLocalBrief[] }> {
  return apiFetch<{ items: SavedLocalBrief[] }>("/v1/local-brief/saved", { method: "GET" }, opts);
}

/** DELETE /v1/local-brief/saved/:id — resolves on 204 (apiFetch returns undefined). */
export function deleteSavedLocalBrief(id: string, opts: FetchOpts = {}): Promise<void> {
  return apiFetch<void>(
    `/v1/local-brief/saved/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    opts,
  );
}
