import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { useSession } from "@/auth/session";

export default function TabsLayout() {
  const { ready, session, isAdmin } = useSession();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  if (!session) return <Redirect href="/auth" />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: "#000" },
        headerTintColor: "#fff",
        tabBarStyle: { backgroundColor: "#000", borderTopColor: "#222" },
        tabBarActiveTintColor: "#fff",
        tabBarInactiveTintColor: "#666",
      }}
    >
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
