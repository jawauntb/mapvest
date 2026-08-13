import { useSession } from "@/auth/session";
import { useSidebar } from "@/nav/SidebarContext";
import { colors, motion } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Slim bottom bar: Home · Map · Camera.
 * List is a map-mode route (nearby, sorted). Research, Saved, Settings
 * live in the sidebar (≡).
 */
export default function TabsLayout() {
  // SidebarProvider + AppSidebar now live at the root _layout.tsx so detail
  // screens (which are siblings of the tabs layout) also have access to
  // useSidebar. This screen just uses the provider from above.
  return (
    <>
      <TabsInner />
      <EdgeSwipeOpener />
    </>
  );
}

/**
 * Slim left-edge swipe zone that opens the sidebar. Sits above tab content
 * but is only 20pt wide and only activates on a right-swipe of ≥40pt, so
 * it never intercepts tap targets on any tab screen.
 */
function EdgeSwipeOpener() {
  const { openSidebar } = useSidebar();
  const pan = Gesture.Pan()
    // Only activate once the finger has moved ≥30pt right — leaves horizontal
    // list scrolls and taps in front of it untouched.
    .activeOffsetX([30, 30])
    .onEnd((e) => {
      if (e.translationX > 40 && Math.abs(e.velocityX) > 0) {
        runOnJS(openSidebar)();
      }
    });
  return (
    <GestureDetector gesture={pan}>
      <View
        pointerEvents="box-only"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: 20,
        }}
      />
    </GestureDetector>
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
            href: null,
            title: "Nearby",
          }}
        />
      {/* Sidebar destinations — hidden from tab bar */}
      <Tabs.Screen
        name="research"
        options={{ href: null, title: "Research", headerShown: false }}
      />
      <Tabs.Screen name="saved" options={{ href: null, title: "Watchlist" }} />
      <Tabs.Screen
        name="settings"
        options={{ href: null, title: "Settings", headerShown: false }}
      />
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
