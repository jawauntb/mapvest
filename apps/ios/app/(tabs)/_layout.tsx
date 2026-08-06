import { useSession } from "@/auth/session";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider, useSidebar } from "@/nav/SidebarContext";
import { colors, motion } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Slim bottom bar: Home (watchlist) · Map · Camera · List.
 * Research, Saved, Settings live in the ChatGPT-style sidebar (≡).
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
            onPress={() => {
              hapticSelect();
              openSidebar();
            }}
            hitSlop={12}
            style={{
              paddingHorizontal: 14,
              minWidth: 44,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
            accessibilityRole="button"
            accessibilityLabel="Open menu"
          >
            <Ionicons name="menu-outline" size={24} color={colors.fg} />
          </Pressable>
        ),
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.fgDim,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        lazy: true,
        freezeOnBlur: true,
      }}
      screenListeners={{
        tabPress: () => hapticSelect(),
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          headerShown: false, // custom top bar with menu button
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              color={color}
              focused={focused}
              iconOn="home"
              iconOff="home-outline"
              accessibilityLabel="Home"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: "Map",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              color={color}
              focused={focused}
              iconOn="map"
              iconOff="map-outline"
              accessibilityLabel="Map"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="camera"
        options={{
          title: "Camera",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              color={color}
              focused={focused}
              iconOn="camera"
              iconOff="camera-outline"
              accessibilityLabel="Camera"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="list"
        options={{
          title: "List",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              color={color}
              focused={focused}
              iconOn="list"
              iconOff="list-outline"
              accessibilityLabel="List"
            />
          ),
        }}
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
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              color={color}
              focused={focused}
              iconOn="shield-checkmark"
              iconOff="shield-checkmark-outline"
              accessibilityLabel="Admin"
            />
          ),
        }}
      />
    </Tabs>
  );
}

function TabIcon({
  color,
  focused,
  iconOn,
  iconOff,
  accessibilityLabel,
}: {
  color: string;
  focused: boolean;
  iconOn: IconName;
  iconOff: IconName;
  accessibilityLabel: string;
}) {
  const scale = useSharedValue(focused ? 1.08 : 1);

  useEffect(() => {
    scale.value = withSpring(focused ? 1.1 : 1, motion.springSnappy);
  }, [focused, scale]);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View
      style={[
        {
          width: 30,
          height: 30,
          alignItems: "center",
          justifyContent: "center",
        },
        animStyle,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Ionicons
        name={focused ? iconOn : iconOff}
        size={24}
        color={color}
        accessibilityLabel={accessibilityLabel}
      />
    </Animated.View>
  );
}
