import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@/api/types";
import { getMe } from "@/api/client";

const KEY = "mapvest.session.v1";

type Stored = { session: Session; user: User };

type SessionCtx = {
  ready: boolean;
  session: Session | null;
  user: User | null;
  signIn: (s: Session, u: User) => Promise<void>;
  signOut: () => Promise<void>;
  isAdmin: boolean;
};

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<Stored | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Stored;
        if (new Date(parsed.session.expiresAt).getTime() < Date.now()) {
          await SecureStore.deleteItemAsync(KEY);
          return;
        }
        if (!cancelled) setState(parsed);
        // opportunistic refresh of user profile
        try {
          const { user } = await getMe(parsed.session.token);
          if (!cancelled) setState({ session: parsed.session, user });
        } catch {
          // network error is fine; keep cached user
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<SessionCtx>(
    () => ({
      ready,
      session: state?.session ?? null,
      user: state?.user ?? null,
      isAdmin: !!state?.user?.scopes?.includes("admin"),
      async signIn(session, user) {
        const next = { session, user };
        await SecureStore.setItemAsync(KEY, JSON.stringify(next));
        setState(next);
      },
      async signOut() {
        await SecureStore.deleteItemAsync(KEY);
        setState(null);
      },
    }),
    [ready, state],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside <SessionProvider>");
  return v;
}
