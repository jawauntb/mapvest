import { ApiError, getMe } from "@/api/client";
import type { Session, User } from "@/api/types";
import { unlinkPushForSignOut } from "@/notif/signOut";
import * as SecureStore from "expo-secure-store";
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";

const KEY = "mapvest.session.v1";
const STORE: SecureStore.SecureStoreOptions = {
  keychainService: "com.mapvest.app",
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};
const STORE_MS = 800;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(null);
    });
  });
}

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
        const raw = await withTimeout(SecureStore.getItemAsync(KEY, STORE), STORE_MS);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Stored;
        if (new Date(parsed.session.expiresAt).getTime() < Date.now()) {
          await SecureStore.deleteItemAsync(KEY, STORE);
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
            await SecureStore.deleteItemAsync(KEY, STORE);
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
        try {
          await SecureStore.setItemAsync(KEY, JSON.stringify(next), STORE);
        } catch (e) {
          console.warn("[session] persist failed (in-memory only):", e);
        }
        setState(next);
      },
      async signOut() {
        // Push unlink must complete while this bearer is still available.
        // If neither the server nor native Expo can revoke a known token,
        // this rejects and deliberately leaves the account/session in place
        // so Settings or Admin can present a retry instead of false safety.
        if (state?.session) await unlinkPushForSignOut(state.session);
        try {
          await SecureStore.deleteItemAsync(KEY, STORE);
        } catch {
          /* keychain miss is fine */
        }
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
