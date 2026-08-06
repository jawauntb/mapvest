import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { enableFreeze } from "react-native-screens";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "@/auth/session";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider } from "@/nav/SidebarContext";
import { registerForPush } from "@/notif/registerForPush";
import { pathFromNotificationData, type NotifData } from "@/notif/router";
import { colors } from "@/theme/tokens";

enableFreeze(true);

// Foreground notification handler. Without this, a push received while the
// app is open would be silently swallowed. We show the alert banner + play
// the sound so users know the notification fired.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "mapvest.rq.v1",
});

/**
 * One-time push registration + tap-through router. Mounted inside
 * SessionProvider so the effect can read the current session token.
 * Registration is idempotent server-side; we still guard on session so
 * we don't hit /v1/push/register while signed out.
 */
function PushBridge() {
  const { session } = useSession();
  const router = useRouter();

  // Register on session-ready. Effect deps on the token so a fresh sign-in
  // registers the token under the new user.
  useEffect(() => {
    if (!session?.token) return;
    void registerForPush(session);
  }, [session?.token]);

  // Tap-through: turn `data.kind` into a screen. Cold-launch and warm-launch
  // both funnel through here — `getLastNotificationResponseAsync` covers
  // cold launches, the subscription covers warm.
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
        /* not fatal — cold-launch tap can't be recovered without OS help */
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
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 1000 * 60 * 60 * 24, // keep for AsyncStorage persist
            retry: 1,
          },
          mutations: { retry: 0 },
        },
      }),
    [],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister,
            maxAge: 1000 * 60 * 60 * 24,
            dehydrateOptions: {
              shouldDehydrateQuery: (q) => {
                const key0 = q.queryKey[0];
                // Persist map/list/identify/charts/watchlist — skip ephemeral agent streams.
                if (key0 === "agent-threads" || key0 === "agent-overview") return false;
                return q.state.status === "success";
              },
            },
          }}
        >
          <SessionProvider>
            {/* SidebarProvider MUST wrap the whole Stack — detail screens are
                siblings of (tabs), so a provider inside (tabs)/_layout.tsx
                would leave `useSidebar()` unresolvable from detail. Global
                sidebar means burger + edge-swipe work from every screen. */}
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
              </Stack>
              <AppSidebar />
            </SidebarProvider>
          </SessionProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
