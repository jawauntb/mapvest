// BUILD 13 RED-SCREEN DIAGNOSTIC — ACTIVE ROOT.
//
// Build 12 (ShareIntent stripped + non-blocking RQ hydrate + splash
// fallback) still solid-black on iPhone 15 Pro / iOS 26.5.2. This root
// replaces the full provider tree with a single red View + "ROOT MOUNTED".
// No SessionProvider, GestureHandlerRootView, SafeAreaProvider, navigation,
// or async init beyond an immediate SplashScreen.hideAsync().
//
// Discriminating test:
//
//   Red visible on device → native + JS bundle + root registration all
//   work; black on build 12 was still something in the remaining Provider
//   chain (SessionProvider, GestureHandlerRootView, or SafeAreaProvider).
//   Next: restore providers one at a time.
//
//   Still black on device → failure is below React. Root module never
//   executes, root component isn't registering with the native view, or
//   the JS bundle isn't loading in production. Escalation: (a) disable
//   newArchEnabled, (b) downgrade reanimated / drop worklets, (c) wait
//   for Expo SDK 55 iOS 26 fixes.
//
// Prior provider-chain root kept at `app/_layout.build12.tsx` (inactive —
// expo-router ignores non-`_layout.tsx` filenames).
import * as SplashScreen from "expo-splash-screen";
import { Text, View } from "react-native";

SplashScreen.hideAsync().catch(() => {});

export default function RedScreenRoot() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "red",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "white", fontSize: 24, fontWeight: "800" }}>
        ROOT MOUNTED
      </Text>
      <Text style={{ color: "white", fontSize: 14, marginTop: 12 }}>
        build 13 diagnostic
      </Text>
    </View>
  );
}
