import { findsQueryKeyPrefix } from "@/finds/queryKeys";

/** Query keys for the signed-in find-derived surfaces. */
const FIND_SURFACE_QUERY_NAMES = ["progress", "universe-summary", "dex", "quests"] as const;

export const FIND_SURFACE_FOLLOW_UP_DELAY_MS = 750;

type FindSurfaceQueryFilters = {
  queryKey: readonly unknown[];
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

const pendingFindRefreshGenerations = new Map<string, number>();
const activeFocusRefreshes = new Map<string, ActiveFocusRefresh>();

type ActiveFocusRefresh = {
  disposed: boolean;
  generation: number;
  timer: unknown;
};

function normalizedToken(token: string | undefined): string | undefined {
  const value = token?.trim();
  return value || undefined;
}

/** Mark one authenticated token as needing a find-surface refresh. */
export function markFindRefreshPending(token: string | undefined): void {
  const value = normalizedToken(token);
  if (!value) return;
  pendingFindRefreshGenerations.set(value, (pendingFindRefreshGenerations.get(value) ?? 0) + 1);
}

/** Pure read used by tests and focus callers to verify token isolation. */
export function hasFindRefreshPending(token: string | undefined): boolean {
  const value = normalizedToken(token);
  return value ? pendingFindRefreshGenerations.has(value) : false;
}

/**
 * The `finds` prefix deliberately omits the list limit so one server write
 * invalidates both the 100-row and 200-row observers without sharing caches.
 */
export function findSurfaceQueryKeys(token: string): readonly (readonly unknown[])[] {
  return [
    findsQueryKeyPrefix(token),
    ...FIND_SURFACE_QUERY_NAMES.map((name) => [name, token] as const),
  ];
}

/**
 * If a successful authenticated identify marked this token as pending, refresh
 * active find surfaces now and once more after the server-side recording has
 * had a bounded window to finish. Blur cancels the timer but preserves the
 * marker for the next eligible focus. Only the completed follow-up clears it.
 */
export function refreshFindSurfacesOnFocus(
  queryClient: FindSurfaceQueryClient,
  token: string | undefined,
  scheduler: FocusRefreshScheduler = defaultScheduler,
): () => void {
  const value = normalizedToken(token);
  if (!value || !pendingFindRefreshGenerations.has(value)) return () => {};

  // A focus callback can be re-entered during a transition. One timer and one
  // immediate wave per token keeps hidden/duplicated listeners harmless.
  if (activeFocusRefreshes.has(value)) return () => {};

  const generation = pendingFindRefreshGenerations.get(value)!;
  const active: ActiveFocusRefresh = {
    disposed: false,
    generation,
    timer: undefined,
  };
  const refresh = () => {
    if (active.disposed) return;
    for (const queryKey of findSurfaceQueryKeys(value)) {
      void queryClient.invalidateQueries({ queryKey, refetchType: "active" });
    }
  };

  activeFocusRefreshes.set(value, active);
  refresh();
  active.timer = scheduler.setTimeout(() => {
    if (active.disposed) return;
    refresh();
    active.disposed = true;
    activeFocusRefreshes.delete(value);
    if (pendingFindRefreshGenerations.get(value) === active.generation) {
      pendingFindRefreshGenerations.delete(value);
    }
  }, FIND_SURFACE_FOLLOW_UP_DELAY_MS);

  return () => {
    if (!active || active.disposed) return;
    active.disposed = true;
    activeFocusRefreshes.delete(value);
    scheduler.clearTimeout(active.timer);
  };
}
