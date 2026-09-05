import {
  type SituateChatMessage,
  type SituateCitation,
  formatSituateError,
  situateChat,
} from "@/api/situate";
import { useCallback, useState } from "react";

export type SituateChatTurn = SituateChatMessage & {
  id: string;
  citations?: SituateCitation[];
  failed?: boolean;
};

export type SituateChatState = {
  turns: SituateChatTurn[];
  pending: boolean;
  error: string | null;
  send: (message: string) => void;
  reset: () => void;
};

let seq = 0;
function nextId(): string {
  seq += 1;
  return `t${seq}`;
}

/**
 * Thread state for the packet chat.
 *
 * The engine answers only from the stored packet, so the thread is cheap and
 * disposable — it lives in component state, not the query cache. History is
 * sent with every turn (the client owns the thread) and a `conversationId`, if
 * the engine hands one back, is echoed so it can persist the thread server-side.
 */
export function useSituateChat(ticker: string, token?: string): SituateChatState {
  const [turns, setTurns] = useState<SituateChatTurn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    (raw: string) => {
      const message = raw.trim();
      if (!message || pending || !ticker) return;
      const history: SituateChatMessage[] = turns
        .filter((t) => !t.failed)
        .map((t) => ({ role: t.role, content: t.content }));
      setTurns((prev) => [...prev, { id: nextId(), role: "user", content: message }]);
      setPending(true);
      setError(null);
      situateChat({ ticker, message, conversationId, history }, { token })
        .then((res) => {
          if (res.conversationId) setConversationId(res.conversationId);
          setTurns((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "assistant",
              content: res.reply || "The engine returned an empty answer.",
              citations: res.citations ?? [],
            },
          ]);
        })
        .catch((err: unknown) => {
          setError(formatSituateError(err));
          setTurns((prev) => [
            ...prev,
            { id: nextId(), role: "assistant", content: formatSituateError(err), failed: true },
          ]);
        })
        .finally(() => setPending(false));
    },
    [conversationId, pending, ticker, token, turns],
  );

  const reset = useCallback(() => {
    setTurns([]);
    setConversationId(undefined);
    setError(null);
  }, []);

  return { turns, pending, error, send, reset };
}
