import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "@/auth/session";

export default function Gate() {
  const { ready, session } = useSession();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  return <Redirect href={session ? "/(tabs)/map" : "/auth"} />;
}
