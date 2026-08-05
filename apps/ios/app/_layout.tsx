import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { enableFreeze } from "react-native-screens";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "@/auth/session";

enableFreeze(true);

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "mapvest.rq.v1",
});

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
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="auth" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="detail/[id]"
                options={{
                  presentation: "modal",
                  headerShown: true,
                  title: "Investable",
                }}
              />
            </Stack>
          </SessionProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
