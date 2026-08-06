import { AppSidebar } from "@/components/AppSidebar";
import { useSession } from "@/auth/session";
import { SidebarProvider, useSidebar } from "@/nav/SidebarContext";
import { colors } from "@/theme/tokens";
import { Tabs } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

/**
 * Slim bottom bar: Home (watchlist) · Map · Camera · List.
 * Research, Saved, Settings live in the ChatGPT-style sidebar (☰).
 */
export default function TabsLayout() {
  const { ready } = useSession();

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.bg,
        }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <SidebarProvider>
      <TabsInner />
      <AppSidebar />
    </SidebarProvider>
  );
}

function TabsInner() {
  const { isAdmin } = useSession();
  const { openSidebar } = useSidebar();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.fg,
        headerTitleStyle: { fontWeight: "700" },
        headerLeft: () => (
          <Pressable
            onPress={openSidebar}
            hitSlop={12}
            style={{ paddingHorizontal: 14 }}
            accessibilityLabel="Open menu"
          >
            <Text style={{ color: colors.fg, fontSize: 20, fontWeight: "700" }}>☰</Text>
          </Pressable>
        ),
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.fgDim,
        lazy: true,
        freezeOnBlur: true,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          headerShown: false, // custom top bar with burger
          tabBarIcon: ({ color }) => <TabDot color={color} label="⌂" />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{ title: "Map", tabBarIcon: ({ color }) => <TabDot color={color} label="M" /> }}
      />
      <Tabs.Screen
        name="camera"
        options={{ title: "Camera", tabBarIcon: ({ color }) => <TabDot color={color} label="C" /> }}
      />
      <Tabs.Screen
        name="list"
        options={{ title: "List", tabBarIcon: ({ color }) => <TabDot color={color} label="≡" /> }}
      />
      {/* Sidebar destinations — hidden from tab bar */}
      <Tabs.Screen name="research" options={{ href: null, title: "Research" }} />
      <Tabs.Screen name="saved" options={{ href: null, title: "Watchlist" }} />
      <Tabs.Screen name="settings" options={{ href: null, title: "Settings" }} />
      <Tabs.Screen
        name="admin"
        options={{
          title: "Admin",
          href: isAdmin ? "/(tabs)/admin" : null,
          tabBarIcon: ({ color }) => <TabDot color={color} label="⚙" />,
        }}
      />
    </Tabs>
  );
}

function TabDot({ color, label }: { color: string; label: string }) {
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderColor: color,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color, fontSize: 12, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}
