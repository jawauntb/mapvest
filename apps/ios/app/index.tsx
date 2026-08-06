import { useSession } from "@/auth/session";
import { colors } from "@/theme/tokens";
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

export default function Gate() {
  const { ready, session } = useSession();
  if (!ready) {
    return (
      <View
        style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  // Signed-in users land on the map (the core loop); guests land on Home so
  // the Sign in CTA is the first thing they see, one tap from every tab.
  return <Redirect href={session ? "/(tabs)/map" : "/(tabs)/home"} />;
}
