// BUILD 17 BARE-APPREGISTRY + iOS26 TURBOMODULE PATCH — ACTIVE ENTRY.
//
// Build 14 shipped the red-screen `_layout.tsx` (verified: "ROOT MOUNTED"
// is inside main.jsbundle) but the device still solid-blacked. That means
// either (a) expo-router's eager route import graph (RNGH / Reanimated /
// worklets / share-intent) hangs before the root layout can paint, or
// (b) the JS runtime never reaches a successful React mount at all.
//
// This entry bypasses expo-router entirely — no route context, no widget
// task handler, no provider chain. Registers a single red View as `main`
// (matches AppDelegate.moduleName). Discriminating test:
//
//   Red on device → JS + React + native view attach work; killer is in
//   expo-router / route-module eval / provider chain. Restore
//   `index.full.js` and bisect.
//
//   Still black → failure is below our JS (Hermes / New Arch / native
//   bridge). Next: `newArchEnabled: false`.
//
// Prior entry kept at `index.full.js`.
import { AppRegistry, Text, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";

SplashScreen.hideAsync().catch(() => {});

function BareRedScreen() {
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
        build 17 patched RN + bare AppRegistry
      </Text>
    </View>
  );
}

AppRegistry.registerComponent("main", () => BareRedScreen);
