import { fetchEntitlements } from "@/api/client";
import type { EntitlementState } from "@/api/types";
import { useSession } from "@/auth/session";
import { useQuery } from "@tanstack/react-query";

export const ENTITLEMENTS_QUERY_KEY = ["entitlements"] as const;

export function useEntitlements() {
  const { session } = useSession();
  return useQuery<EntitlementState>({
    queryKey: [...ENTITLEMENTS_QUERY_KEY, session?.token ?? "anon"],
    queryFn: () => fetchEntitlements({ token: session?.token }),
    staleTime: 15_000,
  });
}
