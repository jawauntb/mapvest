import { listFinds } from "@/api/finds";
import { useSession } from "@/auth/session";
import { findsQueryKey } from "@/finds/queryKeys";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { readFirstFindFlag } from "./firstFindStorage";
import { firstFindFlagQueryKey, hasFirstFind } from "./gate";

/**
 * Live unlock for comps / news / brief. Re-reads the guest flag on focus so
 * a just-finished identify unlocks after navigate-away or pull-to-refresh.
 * Fail-closed while the flag has not resolved and no finds are cached.
 */
export function useHasFirstFind() {
  const { session } = useSession();
  const qc = useQueryClient();

  const flagQ = useQuery({
    queryKey: firstFindFlagQueryKey,
    queryFn: readFirstFindFlag,
    staleTime: 0,
    retry: false,
  });

  const findsQ = useQuery({
    queryKey: findsQueryKey(session?.token),
    queryFn: () => listFinds({ token: session?.token }),
    enabled: !!session?.token,
    staleTime: 30_000,
  });

  const refresh = useCallback(() => {
    void flagQ.refetch();
    if (session?.token) void findsQ.refetch();
  }, [flagQ, findsQ, session?.token]);

  useFocusEffect(
    useCallback(() => {
      void qc.invalidateQueries({ queryKey: firstFindFlagQueryKey });
    }, [qc]),
  );

  return {
    unlocked: hasFirstFind({
      finds: findsQ.data?.finds,
      guestFlag: flagQ.data,
    }),
    refresh,
  };
}
