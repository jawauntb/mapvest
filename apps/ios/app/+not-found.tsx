import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, type } from "@/theme/tokens";
import { Stack, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Fallback for any URL Expo Router can't match (bad deep link, stale share
 * URL, malformed push payload). Without this file the built-in Unmatched
 * screen renders — fine in dev, but on a share-sheet cold start it competed
 * with the share-intent navigation. Keep it calm and route the user home.
 */
export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <Stack.Screen options={{ title: "Mapvest" }} />
      <View style={styles.center}>
        <Text style={styles.title}>That link didn't resolve</Text>
        <Text style={styles.subtitle}>
          The page may have moved, or the link was malformed. Head home and try again.
        </Text>
        <PrimaryButton
          label="Go home"
          onPress={() => router.replace("/(tabs)/home")}
          style={{ marginTop: 16, alignSelf: "stretch" }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  title: { color: colors.fg, ...type.h3, fontSize: 18, textAlign: "center" },
  subtitle: { color: colors.fgMuted, fontSize: 13, textAlign: "center", marginTop: 8 },
});
