import { useSession } from "@/auth/session";
import { useSidebar } from "@/nav/SidebarContext";
import { colors } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

/**
 * No bottom tab bar — free the real estate; Home + profile drawer + camera
 * (map/list header) cover every destination. Tab routes still exist for
 * deep links / sidebar navigation; they just aren't chrome.
 */
export default function TabsLayout() {
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
    // Single positive threshold = activate only after a 30pt rightward pan.
    // The old two-element form ([30, 30]) is invalid — the first entry must
    // be negative — and made the gesture activate on any horizontal move.
    .activeOffsetX(30)
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

/** Same chrome as AppTopBar's burger so native tab headers match custom ones. */
const headerBtn = {
  width: 40,
  height: 40,
  borderRadius: 20,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.bgElevated,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  marginHorizontal: 10,
};

function ProfileHeaderButton() {
  const { openSidebar } = useSidebar();
  return (
    <Pressable
      onPress={() => {
        hapticSelect();
        openSidebar();
      }}
      hitSlop={12}
      style={headerBtn}
      accessibilityRole="button"
      accessibilityLabel="Open menu"
    >
      <Ionicons name="menu-outline" size={22} color={colors.fg} />
    </Pressable>
  );
}

function CameraHeaderButton() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => {
        hapticSelect();
        router.push("/(tabs)/camera?intent=snap");
      }}
      hitSlop={12}
      style={headerBtn}
      accessibilityRole="button"
      accessibilityLabel="Open camera"
    >
      <Ionicons name="camera-outline" size={22} color={colors.fg} />
    </Pressable>
  );
}

function TabsInner() {
  const { isAdmin } = useSession();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.fg,
        headerTitleStyle: { fontWeight: "700" },
        headerLeft: () => <ProfileHeaderButton />,
        tabBarStyle: { display: "none", height: 0 },
        tabBarButton: () => null,
        lazy: true,
        freezeOnBlur: true,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: "Map",
          headerRight: () => <CameraHeaderButton />,
        }}
      />
      <Tabs.Screen
        name="camera"
        options={{
          title: "Camera",
          href: null,
        }}
      />
      <Tabs.Screen
        name="list"
        options={{
          href: null,
          title: "Nearby",
          headerRight: () => <CameraHeaderButton />,
        }}
      />
      <Tabs.Screen
        name="research"
        options={{ href: null, title: "Research", headerShown: false }}
      />
      <Tabs.Screen
        name="settings"
        options={{ href: null, title: "Settings" }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: "Admin",
          href: isAdmin ? "/(tabs)/admin" : null,
        }}
      />
    </Tabs>
  );
}
