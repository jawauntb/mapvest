import { getMe } from "@/api/client";
import type { Session, User } from "@/api/types";
import { cancelPushOperationsAndWait, runPushRevocation } from "@/notif/lifecycle";
import { readPushClaimSnapshot } from "@/notif/registerForPush";
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
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { type CleanupReason, SessionController, type SessionSnapshot } from "./sessionController";
import { createSessionStore } from "./sessionStore";

export { SessionCleanupRequiredError, SessionPersistenceError } from "./sessionController";
export type { CleanupReason } from "./sessionController";

const KEY = "mapvest.session.v1";
const STORE: SecureStore.SecureStoreOptions = {
  keychainService: "com.mapvest.app",
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

const sessionStore = createSessionStore(
  {
    getItem: () => SecureStore.getItemAsync(KEY, STORE),
    setItem: (raw) => SecureStore.setItemAsync(KEY, raw, STORE),
    deleteItem: () => SecureStore.deleteItemAsync(KEY, STORE),
  },
  800,
);

type SessionCtx = {
  phase: SessionSnapshot["phase"];
  ready: boolean;
  session: Session | null;
  user: User | null;
  cleanupRequired: boolean;
  cleanupReason: CleanupReason | null;
  authGeneration: number;
  signIn: (s: Session, u: User) => Promise<void>;
  signOut: () => Promise<void>;
  retryCleanup: () => Promise<void>;
  isAuthGenerationCurrent: (generation: number) => boolean;
  isActiveSession: (generation: number, token: string) => boolean;
  isAdmin: boolean;
};

const Ctx = createContext<SessionCtx | null>(null);

const INITIAL_SNAPSHOT: SessionSnapshot = {
  phase: "booting",
  ready: false,
  session: null,
  user: null,
  cleanupRequired: false,
  cleanupReason: null,
  authGeneration: 0,
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(INITIAL_SNAPSHOT);
  const controllerRef = useRef<SessionController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new SessionController(
      {
        readStoredSession: sessionStore.read,
        getMe: (token, signal) => getMe(token, { signal }),
        revokePush: (session, options) =>
          runPushRevocation(() => unlinkPushForSignOut(session, options)),
        cancelPush: cancelPushOperationsAndWait,
        writeStoredSession: sessionStore.write,
        deleteStoredSession: sessionStore.remove,
        writeCleanupTombstone: sessionStore.writeCleanupTombstone,
        clearCleanupTombstone: sessionStore.clearCleanupTombstone,
        readPushCleanupSnapshot: readPushClaimSnapshot,
      },
      setSnapshot,
    );
  }
  const controller = controllerRef.current;

  useEffect(() => {
    void controller.startBoot();
    return () => controller.dispose();
  }, [controller]);

  const value = useMemo<SessionCtx>(
    () => ({
      phase: snapshot.phase,
      ready: snapshot.ready,
      session: snapshot.session,
      user: snapshot.user,
      cleanupRequired: snapshot.cleanupRequired,
      cleanupReason: snapshot.cleanupReason,
      authGeneration: snapshot.authGeneration,
      signIn: (session, user) => controller.signIn(session, user),
      signOut: () => controller.signOut(),
      retryCleanup: () => controller.retryCleanup(),
      isAuthGenerationCurrent: (generation) => controller.isAuthGenerationCurrent(generation),
      isActiveSession: (generation, token) => controller.isActiveSession(generation, token),
      isAdmin: !!snapshot.user?.scopes?.includes("admin"),
    }),
    [controller, snapshot],
  );

  return (
    <Ctx.Provider value={value}>
      {snapshot.cleanupRequired ? (
        <CleanupRequiredScreen retry={value.retryCleanup} />
      ) : !snapshot.ready ? (
        <SessionTransitionScreen phase={snapshot.phase} />
      ) : (
        children
      )}
    </Ctx.Provider>
  );
}

function SessionTransitionScreen({ phase }: { phase: SessionSnapshot["phase"] }) {
  return (
    <View
      style={styles.cleanupRoot}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading Mapvest"
    >
      <ActivityIndicator color="#60a5fa" size="large" />
      <Text style={styles.cleanupTitle}>
        {phase === "booting" ? "Securing this device…" : "Loading Mapvest…"}
      </Text>
      <Text style={styles.cleanupBody}>
        {phase === "booting"
          ? "Please wait while we finish the account transition."
          : "Restoring your session securely."}
      </Text>
    </View>
  );
}

function CleanupRequiredScreen({ retry }: { retry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={styles.cleanupRoot}>
      <Text style={styles.cleanupTitle}>Finishing account cleanup</Text>
      <Text style={styles.cleanupBody}>
        Mapvest could not safely confirm this device is disconnected. Keep this screen open and
        retry before signing in again.
      </Text>
      {error ? <Text style={styles.cleanupError}>{error}</Text> : null}
      <Pressable
        style={styles.cleanupButton}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Retry account cleanup"
        accessibilityState={{ disabled: busy, busy }}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try {
            await retry();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Cleanup is still unavailable.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.cleanupButtonText}>Retry</Text>
        )}
      </Pressable>
    </View>
  );
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside <SessionProvider>");
  return v;
}

const styles = StyleSheet.create({
  cleanupRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    backgroundColor: "#09090b",
    gap: 14,
  },
  cleanupTitle: { color: "#ffffff", fontSize: 22, fontWeight: "700", textAlign: "center" },
  cleanupBody: { color: "#a1a1aa", fontSize: 15, lineHeight: 22, textAlign: "center" },
  cleanupError: { color: "#fb7185", fontSize: 14, textAlign: "center" },
  cleanupButton: {
    minHeight: 48,
    minWidth: 140,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingHorizontal: 20,
    backgroundColor: "#2563eb",
  },
  cleanupButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
});
