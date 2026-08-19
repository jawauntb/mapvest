import { shouldRetryQuery } from "@/api/errors";
import { SessionProvider, useSession } from "@/auth/session";
import { PaywallProvider } from "@/billing/Paywall";
import { AppSidebar } from "@/components/AppSidebar";
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary";
import { FirstOpenSheet } from "@/components/FirstOpenSheet";
import { SidebarProvider } from "@/nav/SidebarContext";
import { registerForPush } from "@/notif/registerForPush";
import { type NotifData, pathFromNotificationData } from "@/notif/router";
import { ShareIntentListener } from "@/share/ShareIntentListener";
import { colors } from "@/theme/tokens";
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
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

// Splash hides immediately so a hung native module cannot leave a black
// window. ShareIntentProvider used to wrap the tree at boot and could
// stall first paint on iOS 26 — we mount it after the first frame.

SplashScreen.hideAsync().catch(() => {});

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
  buster: "v2",
};

/**
 * One-time push registration + tap-through router. Mounted inside
 * SessionProvider so the effect can read the current session token.
 */
function PushBridge() {
  const { session } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!session?.token) return;
    void registerForPush(session);
  }, [session?.token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (cancelled || !last) return;
        const data = last.notification.request.content.data as NotifData | undefined;
        const path = pathFromNotificationData(data);
        if (path) router.push(path as never);
      } catch {
        /* not fatal */
      }
    })();
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as NotifData | undefined;
      const path = pathFromNotificationData(data);
      if (path) router.push(path as never);
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [router]);

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
                    presentation: "modal",
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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
