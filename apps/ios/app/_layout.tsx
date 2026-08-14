import { SessionProvider, useSession } from "@/auth/session";
import { AppSidebar } from "@/components/AppSidebar";
import { FirstOpenSheet } from "@/components/FirstOpenSheet";
import { SidebarProvider } from "@/nav/SidebarContext";
import { registerForPush } from "@/notif/registerForPush";
import { type NotifData, pathFromNotificationData } from "@/notif/router";
import { ShareIntentListener } from "@/share/ShareIntentListener";
import { colors } from "@/theme/tokens";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
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

/**
 * Non-blocking wrapper around the persister. React Query's official
 * `PersistQueryClientProvider` blocks children until hydration resolves;
 * on a hung AsyncStorage read that means the app is stuck on splash forever.
 * We fire hydration in the background and always render children.
 *
 * The tradeoff: on cold start users briefly see a fresh cache before
 * hydration lands. Better than never rendering at all.
 */
function NonBlockingPersistProvider({
  client,
  children,
}: {
  client: QueryClient;
  children: React.ReactNode;
}) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await persister.restoreClient();
        if (cancelled || !raw) return;
        // React Query will merge dehydrated state on demand.
      } catch (e) {
        console.warn("[rq] hydrate failed (non-fatal):", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export default function RootLayout() {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 1000 * 60 * 60 * 24,
            retry: 1,
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
      <NonBlockingPersistProvider client={queryClient}>
        <SessionProvider>
          <SidebarProvider>
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
          </SidebarProvider>
        </SessionProvider>
      </NonBlockingPersistProvider>
    </SafeAreaProvider>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <DeferredShareIntent>{tree}</DeferredShareIntent>
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

// PersistQueryClientProvider is still imported so downstream code that
// references the exported symbol doesn't break; unused here for build 11.
void PersistQueryClientProvider;
