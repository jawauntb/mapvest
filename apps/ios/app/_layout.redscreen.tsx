// BUILD 12 RED-SCREEN DIAGNOSTIC — staged, not active.
//
// If build 11 still black-screens, we replace `app/_layout.tsx` with this
// content and ship as build 12. It renders a single red View with the text
// "ROOT MOUNTED" — no Providers, no navigation, no async init. This is a
// pure discriminating test:
//
//   Red visible on device → native + JS bundle + root registration all
//   work; the black on build 11 was still something in the Provider chain
//   we didn't strip (SessionProvider, GestureHandlerRootView, or
//   SafeAreaProvider).
//
//   Still black on device → the failure is below React. Root module never
//   executes, root component isn't registering with the native view, or
//   the JS bundle isn't loading in production mode. That points at a bad
//   Metro bundle, an incompatible Hermes runtime on iOS 26, or a
//   Reanimated / worklets native module hanging before React can attach.
//
// Kept as a separate file so we can promote it to the active _layout.tsx
// with a single `mv` if needed. Not exported by expo-router while the
// filename ends in `.redscreen.tsx`.
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
        build 12 diagnostic
      </Text>
    </View>
  );
}
