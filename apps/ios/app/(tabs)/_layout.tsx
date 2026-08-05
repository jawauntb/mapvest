import { useSession } from "@/auth/session";
import { colors } from "@/theme/tokens";
import { Tabs } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";

/**
 * Guests can use the whole tab tree (map/camera/live/list/research) without
 * signing in — Phase 8 Slice B. Sign-in is only required for Save/watchlist
 * and Home → Robinhood MCP settings, each of which prompts inline.
 */
export default function TabsLayout() {
  const { ready, isAdmin } = useSession();

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
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.fg,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.fgDim,
        // Keep tab trees alive when switching — Camera/Live keep their last result.
        lazy: true,
        unmountOnBlur: false,
        freezeOnBlur: true,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
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
        name="live-scan"
        options={{ title: "Live", tabBarIcon: ({ color }) => <TabDot color={color} label="L" /> }}
      />
      <Tabs.Screen
        name="list"
        options={{ title: "List", tabBarIcon: ({ color }) => <TabDot color={color} label="≡" /> }}
      />
      <Tabs.Screen
        name="research"
        options={{
          title: "Research",
          tabBarIcon: ({ color }) => <TabDot color={color} label="◎" />,
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{ title: "Saved", tabBarIcon: ({ color }) => <TabDot color={color} label="★" /> }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: "Admin",
          // Hide the tab entirely unless the signed-in user has admin scope.
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
