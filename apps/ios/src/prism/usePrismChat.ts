import {
  type PrismChatMessage,
  type PrismCitation,
  formatPrismError,
  prismChat,
} from "@/api/prism";
import { useCallback, useState } from "react";

export type PrismChatTurn = PrismChatMessage & {
  id: string;
  citations?: PrismCitation[];
  failed?: boolean;
};

export type PrismChatState = {
  turns: PrismChatTurn[];
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
 * the engine hands one back, is echoed so it can persist the thread server-side
 * instead.
 */
export function usePrismChat(ticker: string, token?: string): PrismChatState {
  const [turns, setTurns] = useState<PrismChatTurn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    (raw: string) => {
      const message = raw.trim();
      if (!message || pending || !ticker) return;
      const history: PrismChatMessage[] = turns
        .filter((t) => !t.failed)
        .map((t) => ({ role: t.role, content: t.content }));
      setTurns((prev) => [...prev, { id: nextId(), role: "user", content: message }]);
      setPending(true);
      setError(null);
      prismChat({ ticker, message, conversationId, history }, { token })
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
          setError(formatPrismError(err));
          setTurns((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "assistant",
              content: formatPrismError(err),
              failed: true,
            },
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
