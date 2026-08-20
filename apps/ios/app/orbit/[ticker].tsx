/**
 * Full-screen Orbit — one company's value chain with room to breathe
 * (Universe Roadmap §3 C2). The detail sheet carries a collapsed compact
 * version of the same component; this route is the "Open orbit" destination,
 * where every lane shows its full set of nodes instead of the top three.
 *
 * Deliberately thin: all the graph/pulse/finds fetching, the uncaught
 * silhouette language and the citation panel live in `OrbitView` so the two
 * surfaces cannot drift. This screen is chrome + legend.
 *
 * Fails soft end to end — when `/v1/graph` 404s the body is a single muted
 * line and the screen still renders its header.
 */
import { useSession } from "@/auth/session";
import { AppTopBar } from "@/components/AppTopBar";
import { OrbitView } from "@/components/OrbitView";
import { ScreenFade } from "@/components/ScreenFade";
import { colors, radii, type } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function OrbitScreen() {
  const router = useRouter();
  const { session } = useSession();
  const params = useLocalSearchParams<{ ticker: string | string[]; name?: string }>();
  const raw = Array.isArray(params.ticker) ? params.ticker[0] : params.ticker;
  const ticker = (raw ?? "").trim().toUpperCase();
  const name = Array.isArray(params.name) ? params.name[0] : params.name;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ title: ticker ? `${ticker} orbit` : "Orbit" }} />
      <AppTopBar
        title={ticker ? `$${ticker} orbit` : "Orbit"}
        leading={
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={22} color={colors.fg} />
          </Pressable>
        }
      />
      <ScreenFade>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.lede}>
            Who this company stands on, and who stands on it. Buyers above, suppliers below,
            competitors and complements beside. Tap a node to open it; tap ⓘ for the evidence.
          </Text>

          <View style={styles.card}>
            {ticker ? (
              <OrbitView ticker={ticker} name={name} token={session?.token} variant="full" />
            ) : (
              <Text style={styles.muted}>No ticker in this link.</Text>
            )}
          </View>

          <View style={styles.legend}>
            <View style={styles.legendRow}>
              <View style={styles.legendChip}>
                <Text style={styles.legendChipText}>CAUGHT</Text>
              </View>
              <Text style={styles.legendText}>in your universe</Text>
            </View>
            <View style={styles.legendRow}>
              <View style={[styles.legendChip, styles.legendChipUncaught]}>
                <View style={styles.legendDot} />
                <Text style={[styles.legendChipText, styles.legendChipTextMuted]}>UNCAUGHT</Text>
              </View>
              <Text style={styles.legendText}>find it in the wild to light it up</Text>
            </View>
            <View style={styles.legendRow}>
              <View style={[styles.legendChip, styles.legendChipPrivate]}>
                <Text style={[styles.legendChipText, styles.legendChipTextMuted]}>Private co.</Text>
              </View>
              <Text style={styles.legendText}>no ticker — never invented</Text>
            </View>
          </View>
        </ScrollView>
      </ScreenFade>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  iconBtn: { padding: 4 },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  lede: { color: colors.fgMuted, fontSize: 13, lineHeight: 19 },
  muted: { color: colors.fgMuted, fontSize: 13 },
  card: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: 14,
  },
  legend: { gap: 8 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  legendChipUncaught: {
    opacity: 0.6,
    backgroundColor: colors.bgSunken,
    borderColor: colors.borderStrong,
  },
  legendChipPrivate: { borderStyle: "dashed" },
  legendChipText: { color: colors.fg, fontSize: 11, fontWeight: "700" },
  legendChipTextMuted: { color: colors.fgMuted },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.fgMuted,
  },
  legendText: { color: colors.fgDim, ...type.caption, flexShrink: 1 },
});
