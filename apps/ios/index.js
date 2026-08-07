// BUILD 19 DIAGNOSTIC — bare AppRegistry + New Arch OFF + swallow TurboModule patch.
//
// Device evidence (build 18 on iPhone 15 Pro / iOS 26.5.2):
//   - Process stays alive (no .ips crash)
//   - Console: only UIBackgroundModes warnings — no JS / RN logs
//   - UI: solid black (splash bg #0C0E10)
// Conclusion: hung before paint, not a hard SIGABRT. Community workaround
// that removes this class of failure: newArchEnabled=false (no TurboModules).
// Also upgrade patch from @throw → RCTLogError+return (swallow).
//
// Splash bg set to bright lime so a stuck splash is obvious vs black void.
import { AppRegistry, Text, View } from "react-native";

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
        local Release · newArch OFF
      </Text>
    </View>
  );
}

AppRegistry.registerComponent("main", () => BareRedScreen);
