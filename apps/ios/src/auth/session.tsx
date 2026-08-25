import { ApiError, getMe } from "@/api/client";
import type { Session, User } from "@/api/types";
import { cancelPushOperationsAndWait, runPushRevocation } from "@/notif/lifecycle";
import { unlinkPushForSignOut } from "@/notif/signOut";
import * as SecureStore from "expo-secure-store";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  authFailureNeedsPushCleanup,
  secureStoreReadNeedsPushCleanup,
  sessionExpired,
} from "./sessionPolicy";

const KEY = "mapvest.session.v1";
const STORE: SecureStore.SecureStoreOptions = {
  keychainService: "com.mapvest.app",
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};
const STORE_MS = 800;

function readStoredSession(): Promise<{ raw: string | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve({ raw: null, timedOut: true });
    }, STORE_MS);
    SecureStore.getItemAsync(KEY, STORE)
      .then((raw) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ raw, timedOut: false });
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ raw: null, timedOut: false });
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
  const stateRef = useRef<Stored | null>(null);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await readStoredSession();
        if (secureStoreReadNeedsPushCleanup(loaded.timedOut)) {
          // We cannot prove the session is absent. Revoke the physical push
          // identity without a bearer and retry on the next boot.
          await runPushRevocation(() => unlinkPushForSignOut()).catch(() => undefined);
          return;
        }
        if (!loaded.raw) return;
        let parsed: Stored;
        try {
          parsed = JSON.parse(loaded.raw) as Stored;
        } catch {
          await runPushRevocation(() => unlinkPushForSignOut()).catch(() => undefined);
          await SecureStore.deleteItemAsync(KEY, STORE).catch(() => undefined);
          return;
        }
        if (
          !parsed?.session ||
          typeof parsed.session.token !== "string" ||
          typeof parsed.session.expiresAt !== "string"
        ) {
          await runPushRevocation(() => unlinkPushForSignOut()).catch(() => undefined);
          await SecureStore.deleteItemAsync(KEY, STORE).catch(() => undefined);
          return;
        }
        if (sessionExpired(parsed.session.expiresAt)) {
          const revoked = await runPushRevocation(() => unlinkPushForSignOut(parsed.session))
            .then(() => true)
            .catch(() => false);
          // Keep an expired record when cleanup failed so the next boot (or a
          // direct sign-in) retries the physical-token revocation.
          if (revoked) await SecureStore.deleteItemAsync(KEY, STORE).catch(() => undefined);
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
          if (e instanceof ApiError && authFailureNeedsPushCleanup(e.status)) {
            const revoked = await runPushRevocation(() => unlinkPushForSignOut(parsed.session))
              .then(() => true)
              .catch(() => false);
            if (revoked) await SecureStore.deleteItemAsync(KEY, STORE).catch(() => undefined);
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
        const previous = stateRef.current;
        if (!previous?.session || previous.session.token !== session.token) {
          // Direct A→B login is an account switch even when no explicit
          // sign-out screen ran. Revoke A (or retry a pending boot cleanup)
          // before B becomes observable.
          await runPushRevocation(() => unlinkPushForSignOut(previous?.session));
        } else {
          await cancelPushOperationsAndWait();
        }
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
        // If the server cannot revoke a known token, this rejects and
        // deliberately leaves the account/session in place so Settings or
        // Admin can present a retry instead of treating local cleanup as safe.
        await runPushRevocation(() => unlinkPushForSignOut(stateRef.current?.session));
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
