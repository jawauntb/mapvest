import { shouldRetryQuery } from "@/api/errors";
import { SessionProvider, useSession } from "@/auth/session";
import { PaywallProvider } from "@/billing/Paywall";
import { AppSidebar } from "@/components/AppSidebar";
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary";
import { FirstOpenSheet } from "@/components/FirstOpenSheet";
import { syncWidgetFixIfFresh } from "@/location/heartbeat";
import { SidebarProvider } from "@/nav/SidebarContext";
import { registerForPush } from "@/notif/registerForPush";
import { type NotifData, pathFromNotificationData } from "@/notif/router";
import { ShareIntentListener } from "@/share/ShareIntentListener";
import { colors } from "@/theme/tokens";
import {
  FATAL_JS_EVENT,
  type FatalReport,
  clearPendingFatal,
  getPendingFatal,
  installFatalGuard,
} from "@/util/fatalGuard";
import {
  clearWidgetRegistrationContext,
  saveWidgetRegistrationContext,
} from "@/widgets/widgetLocation";
import { Syne_700Bold, Syne_800ExtraBold } from "@expo-google-fonts/syne";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import { ShareIntentProvider } from "expo-share-intent";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  type AppStateStatus,
  DeviceEventEmitter,
  Pressable,
  Text,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

// Splash hides immediately so a hung native module cannot leave a black
// window. ShareIntentProvider used to wrap the tree at boot and could
// stall first paint on iOS 26 — we mount it after the first frame.

SplashScreen.hideAsync().catch(() => {});

// Must run before anything can throw: uncaught JS errors outside React's
// render phase (timers, event handlers, worklets) otherwise abort() release
// builds via the native ExceptionsManager. See src/util/fatalGuard.ts.
installFatalGuard();

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch (e) {
  console.warn("[push] setNotificationHandler failed at boot:", e);
}

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "mapvest.rq.v1",
});

// PersistQueryClientProvider renders children immediately while restoring
// (it only pauses query fetching until hydration settles), so it cannot
// re-introduce the boot black-screen. Restore failures are swallowed by the
// provider and just leave a fresh cache — fail-open.
const persistOptions = {
  persister,
  maxAge: 1000 * 60 * 60 * 24,
  // v3: drop hydrated auction/agent blobs that used to remount SVG inside
  // the Investable transition and native-crash TestFlight.
  buster: "v3",
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[] }) => {
      const head = query.queryKey[0];
      return (
        head === "resolve-comparable" ||
        head === "quote" ||
        head === "watchlist" ||
        head === "watchlists" ||
        head === "session"
      );
    },
  },
};

/**
 * One-time push registration + tap-through router. Mounted inside
 * SessionProvider so the effect can read the current session token.
 */
function PushBridge() {
  const { session, user, authGeneration, isActiveSession } = useSession();
  const router = useRouter();
  const sessionToken = session?.token;

  const prepareWidgetRelay = useCallback(
    async (
      expectedGeneration: number,
      activeToken: string,
      accountId: string,
    ): Promise<boolean> => {
      // A widget fix is only relayable after this exact account has a current
      // server push registration. This also prevents a pre-registration fix
      // from being mistaken for the next account's location.
      // This launch/foreground path never asks iOS for permission; Settings
      // and Camera's explicit post-value Find evolution action are the
      // consent surfaces.
      let registration: Awaited<ReturnType<typeof registerForPush>>;
      try {
        registration = await registerForPush(
          { token: activeToken, userId: accountId },
          { requestPermission: false },
        );
      } catch {
        registration = null;
      }
      if (!isActiveSession(expectedGeneration, activeToken)) return false;
      if (!registration) {
        await clearWidgetRegistrationContext().catch(() => {});
        return false;
      }
      try {
        await saveWidgetRegistrationContext({
          accountId,
          registrationId: registration.tokenId,
        });
      } catch {
        await clearWidgetRegistrationContext().catch(() => {});
        return false;
      }
      return isActiveSession(expectedGeneration, activeToken);
    },
    [isActiveSession],
  );

  useEffect(() => {
    if (!sessionToken || !user?.id) return;
    const expectedGeneration = authGeneration;
    const activeToken = sessionToken;
    const accountId = user.id;
    let cancelled = false;
    void prepareWidgetRelay(expectedGeneration, activeToken, accountId).then((ready) => {
      if (!cancelled && ready && isActiveSession(expectedGeneration, activeToken)) {
        void syncWidgetFixIfFresh();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authGeneration, isActiveSession, prepareWidgetRelay, sessionToken, user?.id]);

  // Relay any fix the WidgetKit extension captured while the app was closed
  // (roadmap §2 B3). It posts to the same /v1/push/prefs heartbeat this
  // bridge already owns, and is a no-op until the next `expo prebuild`
  // links the extension. Cold "active" transitions only — iOS fires change
  // events for control-center pulls that never left the foreground.
  const appState = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const expectedGeneration = authGeneration;
    if (!session?.token || !user?.id) return;
    const activeToken = session.token;
    const isActive = () => isActiveSession(expectedGeneration, activeToken);
    const syncAfterRegistration = () => {
      if (!isActive()) return;
      void prepareWidgetRelay(expectedGeneration, activeToken, user.id).then((ready) => {
        if (ready && isActive()) void syncWidgetFixIfFresh();
      });
    };
    if (appState.current === "active") syncAfterRegistration();
    const sub = AppState.addEventListener("change", (next) => {
      const prev = appState.current;
      appState.current = next;
      if (next === "active" && prev !== "active") syncAfterRegistration();
    });
    return () => sub.remove();
  }, [authGeneration, isActiveSession, prepareWidgetRelay, session?.token, user?.id]);

  useEffect(() => {
    const expectedGeneration = authGeneration;
    let cancelled = false;
    const routeResponse = (response: Notifications.NotificationResponse) => {
      if (cancelled || !sessionToken || !isActiveSession(expectedGeneration, sessionToken)) return;
      const data = response.notification.request.content.data as NotifData | undefined;
      const path = pathFromNotificationData(data);
      if (path) router.push(path as never);
    };
    (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (last) routeResponse(last);
      } catch {
        /* not fatal */
      }
    })();
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      routeResponse(response);
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [authGeneration, isActiveSession, router, sessionToken]);

  return null;
}

export default function RootLayout() {
  // Brand display font (Syne) loads in the background — rendering is never
  // gated on it. Until it lands, brand moments fall back to system sans.
  useFonts({ Syne_700Bold, Syne_800ExtraBold });

  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 1000 * 60 * 60 * 24,
            retry: shouldRetryQuery,
          },
          mutations: { retry: 0 },
        },
      }),
    [],
  );

  const [rootReady, setRootReady] = useState(false);
  // Fatal JS error captured by the guard: swap the tree for a recovery
  // screen instead of the process dying. `epoch` keys the tree so Recover
  // performs a full remount with fresh state.
  const [fatal, setFatal] = useState<FatalReport | null>(() => getPendingFatal());
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(FATAL_JS_EVENT, (report: FatalReport) => {
      setFatal((prev) => prev ?? report);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // Hide the splash on first paint, with a 3s absolute fallback so we
    // never leave users staring at black.
    setRootReady(true);
    const t = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 3000);
    // Also try immediately once React has painted.
    requestAnimationFrame(() => {
      SplashScreen.hideAsync().catch(() => {});
    });
    return () => clearTimeout(t);
  }, []);

  // Silence "rootReady" unused-var without introducing a runtime branch that
  // could gate rendering — we still render regardless.
  void rootReady;

  const tree = (
    <SafeAreaProvider>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <SessionProvider>
          <SidebarProvider>
            <PaywallProvider>
              <PushBridge />
              <StatusBar style="light" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bg },
                }}
              >
                <Stack.Screen name="index" />
                <Stack.Screen name="auth" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                  name="detail/[id]"
                  options={{
                    // Card push, not a page-sheet modal. Nested UIKit sheets
                    // (Research / news reader) inside a stack modal SIGABRT
                    // on TestFlight / iOS 26 — Expo web never hit this path.
                    presentation: "card",
                    animation: "slide_from_right",
                    headerShown: true,
                    title: "Mapvest",
                    headerStyle: { backgroundColor: colors.bgElevated },
                    headerTintColor: colors.fg,
                    headerTitleStyle: { fontWeight: "700" },
                    contentStyle: { backgroundColor: colors.bg },
                  }}
                />
                <Stack.Screen
                  name="share-intent"
                  options={{
                    presentation: "modal",
                    headerShown: true,
                    title: "Shared to Mapvest",
                    headerStyle: { backgroundColor: colors.bgElevated },
                    headerTintColor: colors.fg,
                    headerTitleStyle: { fontWeight: "700" },
                    contentStyle: { backgroundColor: colors.bg },
                  }}
                />
              </Stack>
              <FirstOpenSheet />
              <AppSidebar />
            </PaywallProvider>
          </SidebarProvider>
        </SessionProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );

  if (fatal) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <FatalRecovery
          report={fatal}
          onRecover={() => {
            clearPendingFatal();
            setFatal(null);
            setEpoch((n) => n + 1);
          }}
        />
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView key={epoch} style={{ flex: 1 }}>
      <ChartErrorBoundary
        title="This screen hit a display error"
        detail="Retry to redraw. Header, quote, and actions should stay usable after a chart or identity glitch."
        retryLabel="Retry screen"
      >
        <DeferredShareIntent>{tree}</DeferredShareIntent>
      </ChartErrorBoundary>
    </GestureHandlerRootView>
  );
}

/**
 * Shown instead of a process kill when the fatal guard traps an uncaught JS
 * error. Surfaces the message so TestFlight screenshots double as crash
 * reports; Recover remounts the whole tree with fresh state.
 */
function FatalRecovery({ report, onRecover }: { report: FatalReport; onRecover: () => void }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        gap: 14,
      }}
    >
      <Text style={{ color: colors.fg, fontSize: 18, fontWeight: "800", textAlign: "center" }}>
        Something went wrong
      </Text>
      <Text style={{ color: colors.fgMuted, fontSize: 13, textAlign: "center" }}>
        Mapvest hit an unexpected error and stopped this screen instead of crashing.
      </Text>
      <Text
        style={{ color: colors.fgMuted, fontSize: 11, textAlign: "center", opacity: 0.8 }}
        numberOfLines={8}
      >
        {report.message}
      </Text>
      <Pressable
        onPress={onRecover}
        accessibilityRole="button"
        accessibilityLabel="Recover"
        style={({ pressed }) => ({
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 999,
          paddingHorizontal: 22,
          paddingVertical: 12,
          backgroundColor: colors.bgElevated,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ color: colors.accent, fontSize: 15, fontWeight: "700" }}>Recover</Text>
      </Pressable>
    </View>
  );
}

/**
 * Mount the share-sheet receiver after first paint. Wrapping at boot was
 * one of the black-screen suspects; delaying keeps Photos → Mapvest without
 * blocking launch.
 */
function DeferredShareIntent({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOn(true), 800);
    return () => clearTimeout(t);
  }, []);
  if (!on) return children;
  return (
    <ShareIntentProvider>
      <ShareIntentListener />
      {children}
    </ShareIntentProvider>
  );
}
