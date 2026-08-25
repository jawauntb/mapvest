export const DEFAULT_FINDS_LIMIT = 100;

/** Canonical cache key for one signed-in user's find list and server limit. */
export function findsQueryKey(token: string | undefined, limit = DEFAULT_FINDS_LIMIT) {
  return ["finds", token, limit] as const;
}

/** Prefix used when a server write may affect every cached find-list limit. */
export function findsQueryKeyPrefix(token: string) {
  return ["finds", token] as const;
}
