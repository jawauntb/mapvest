import { useSession } from "@/auth/session";
import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

export default function Gate() {
  const { ready, session } = useSession();
  // Keep boot distinct from a confirmed guest session. Cleanup-required boot
  // state is rendered by SessionProvider, so this route never flashes guest
  // content while SecureStore or push revocation is unresolved.
  if (!ready) {
    return (
      <View style={styles.root}>
        <ActivityIndicator color="#ffffff" accessibilityLabel="Loading session" />
      </View>
    );
  }
  return <Redirect href={session ? "/(tabs)/map" : "/(tabs)/home"} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#09090b" },
});
