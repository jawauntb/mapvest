/**
 * Query keys for the signed-in find surfaces. Keeping the token in every key
 * prevents a focus refresh from crossing account boundaries.
 */
const FIND_SURFACE_QUERY_NAMES = [
  "finds",
  "progress",
  "universe-summary",
  "dex",
  "quests",
] as const;

export const FIND_SURFACE_FOLLOW_UP_DELAY_MS = 750;

type FindSurfaceQueryName = (typeof FIND_SURFACE_QUERY_NAMES)[number];
type FindSurfaceQueryKey = readonly [FindSurfaceQueryName, string];

type FindSurfaceQueryFilters = {
  queryKey: FindSurfaceQueryKey;
  refetchType: "active";
};

export type FindSurfaceQueryClient = {
  invalidateQueries: (filters: FindSurfaceQueryFilters) => unknown;
};

export type FocusRefreshScheduler = {
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const defaultScheduler: FocusRefreshScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function findSurfaceQueryKeys(token: string): readonly FindSurfaceQueryKey[] {
  return FIND_SURFACE_QUERY_NAMES.map((name) => [name, token] as const);
}

/**
 * Refresh active find surfaces now and once more after identify's asynchronous
 * server-side recording has had a bounded window to finish. The returned
 * cleanup is safe to call repeatedly and cancels the follow-up on blur.
 */
export function refreshFindSurfacesOnFocus(
  queryClient: FindSurfaceQueryClient,
  token: string | undefined,
  scheduler: FocusRefreshScheduler = defaultScheduler,
): () => void {
  if (!token?.trim()) return () => {};

  let disposed = false;
  const refresh = () => {
    if (disposed) return;
    for (const queryKey of findSurfaceQueryKeys(token)) {
      void queryClient.invalidateQueries({ queryKey, refetchType: "active" });
    }
  };

  refresh();
  const followUp = scheduler.setTimeout(refresh, FIND_SURFACE_FOLLOW_UP_DELAY_MS);

  return () => {
    if (disposed) return;
    disposed = true;
    scheduler.clearTimeout(followUp);
  };
}
