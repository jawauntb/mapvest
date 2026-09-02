import {
  type PrismPacket,
  buildPrismPacket,
  formatPrismError,
  getPrismPacket,
  isPacketMissing,
} from "@/api/prism";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type BuildStage, buildStage } from "./progress";

/** How often we ask the read route whether the build has landed. */
const POLL_MS = 5_000;

export type PrismPacketStatus = "loading" | "missing" | "ready" | "error";

export type PrismPacketState = {
  packet: PrismPacket | null;
  status: PrismPacketStatus;
  /** Read-path failure copy (never the raw upstream message). */
  error: string | null;
  /** Build-path failure copy, kept separate so a failed rebuild keeps the packet. */
  buildError: string | null;
  buildErrorRaw: unknown;
  building: boolean;
  elapsedMs: number;
  stage: BuildStage;
  refreshing: boolean;
  build: (opts?: { force?: boolean }) => void;
  refresh: () => void;
};

/**
 * Owns the whole lifecycle of one ticker's packet.
 *
 * `POST /v1/prism` runs the engine and can take 1–3 minutes, which is longer
 * than a phone will reliably hold a socket. So the build is not the only path
 * to a result: while it is in flight we also poll `GET /v1/prism/:ticker` every
 * five seconds, and whichever arrives first wins. A POST that dies on a flaky
 * network therefore still ends with the packet on screen, because the engine
 * stored it and the poll picked it up.
 *
 * A 404 from the read route is not an error — it is the "never built" state,
 * which is what the screen's build CTA is for.
 */
export function usePrismPacket(ticker: string, token?: string): PrismPacketState {
  const qc = useQueryClient();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [buildErrorRaw, setBuildErrorRaw] = useState<unknown>(null);
  const startedAtRef = useRef<number | null>(null);
  startedAtRef.current = startedAt;
  const building = startedAt !== null;

  const query = useQuery({
    queryKey: ["prism", ticker],
    queryFn: ({ signal }) => getPrismPacket(ticker, { token, signal }),
    enabled: ticker.length > 0,
    staleTime: 5 * 60_000,
    retry: (count, err) => !isPacketMissing(err) && count < 2,
    refetchInterval: building ? POLL_MS : false,
    refetchOnWindowFocus: !building,
  });

  // Tick the elapsed clock while a build runs; the staged copy is a function of
  // it, so this is the only timer on the screen.
  useEffect(() => {
    if (startedAt === null) {
      setElapsedMs(0);
      return;
    }
    setElapsedMs(Date.now() - startedAt);
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // A poll that lands a packet generated after the build began ends the build,
  // even if the POST is still hanging.
  const generatedAt = query.data?.generated_at;
  useEffect(() => {
    const started = startedAtRef.current;
    if (started === null || !generatedAt) return;
    const t = Date.parse(generatedAt);
    if (Number.isFinite(t) && t >= started - 1000) setStartedAt(null);
  }, [generatedAt]);

  // `refetch` is stable across renders in react-query v5; the query object is
  // not, so everything below closes over this rather than over `query`.
  const refetch = query.refetch;

  const buildM = useMutation({
    mutationFn: (vars: { force?: boolean }) =>
      buildPrismPacket(ticker, { force: vars.force }, { token }),
    onMutate: () => {
      setBuildErrorRaw(null);
      setStartedAt(Date.now());
    },
    onSuccess: (packet) => {
      qc.setQueryData(["prism", ticker], packet);
      setStartedAt(null);
    },
    onError: (err) => {
      setBuildErrorRaw(err);
      setStartedAt(null);
      // The engine may still finish in the background, so leave the stored
      // packet alone and take one more look.
      void refetch();
    },
  });

  const build = useCallback(
    (opts?: { force?: boolean }) => {
      if (buildM.isPending) return;
      buildM.mutate({ force: opts?.force ?? false });
    },
    [buildM],
  );

  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const status: PrismPacketStatus = query.data
    ? "ready"
    : query.isPending
      ? "loading"
      : isPacketMissing(query.error)
        ? "missing"
        : query.error
          ? "error"
          : "loading";

  const stage = useMemo(() => buildStage(elapsedMs), [elapsedMs]);

  return {
    packet: query.data ?? null,
    status,
    error: query.error && !isPacketMissing(query.error) ? formatPrismError(query.error) : null,
    buildError: buildErrorRaw ? formatPrismError(buildErrorRaw) : null,
    buildErrorRaw,
    building,
    elapsedMs,
    stage,
    refreshing: query.isFetching && !building,
    build,
    refresh,
  };
}
