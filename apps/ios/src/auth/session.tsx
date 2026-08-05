import { ApiError, getMe } from "@/api/client";
import type { Session, User } from "@/api/types";
import * as SecureStore from "expo-secure-store";
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";

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
        // Refresh profile in the background; keep the same token (no rotation
        // needed — sessions are long-lived). Only clear the stored session on
        // a definitive "this token will never work again" signal (unknown
        // user after a Postgres reset, or a token that fails verification).
        // A network blip, timeout, or transient 5xx must NOT sign the user
        // out — that would break "stay signed in until explicit Sign out".
        try {
          const { user } = await getMe(parsed.session.token);
          if (!cancelled) setState({ session: parsed.session, user });
        } catch (e) {
          if (
            e instanceof ApiError &&
            e.status === 401 &&
            /unknown user|invalid token/i.test(e.message)
          ) {
            await SecureStore.deleteItemAsync(KEY);
            if (!cancelled) setState(null);
          }
          // else: keep the cached session/user; retry on next app foreground.
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
