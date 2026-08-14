import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, elevation, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

const STORAGE_KEY = "mapvest.firstOpen.v1";

/**
 * One-screen first-open sheet. Never a carousel. Fail closed: if
 * AsyncStorage throws, skip the sheet so the app is never blocked.
 */
export function FirstOpenSheet() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && seen !== "1") setVisible(true);
      } catch {
        /* fail closed — do not block the app */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function finish(path: "/(tabs)/camera" | "/(tabs)/map") {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* still dismiss — don't trap them on a storage failure */
    }
    setVisible(false);
    router.push(path);
  }

  if (!visible) return null;

  return (
    <Modal
      visible
      animationType="fade"
      transparent
      onRequestClose={() => {
        /* two actions are the only dismiss */
      }}
    >
      <View style={styles.scrim}>
        <View style={[styles.card, elevation.lg]}>
          <Text style={styles.title}>See a brand. Get the ticker.</Text>
          <Text style={styles.body}>
            Snap a storefront or tap a place. Public → the stock. Private → its closest public
            cousin. Every answer shows its sources.
          </Text>
          <Text style={styles.body}>
            Everything you find builds your universe — the map of companies in your world, with the
            research to actually understand them.
          </Text>
          <PrimaryButton
            label="Find your first one"
            onPress={() => void finish("/(tabs)/camera")}
            accessibilityLabel="Find your first one"
            style={{ alignSelf: "stretch" }}
          />
          <Pressable
            onPress={() => {
              hapticSelect();
              void finish("/(tabs)/map");
            }}
            style={styles.secondary}
            accessibilityRole="button"
            accessibilityLabel="Walk the map"
          >
            <Text style={styles.secondaryText}>Walk the map</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 22,
    gap: 14,
  },
  title: { color: colors.fg, ...type.h2, fontSize: 22 },
  body: { color: colors.fgMuted, ...type.body, fontSize: 15, lineHeight: 22 },
  secondary: {
    alignItems: "center",
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: "center",
  },
  secondaryText: { color: colors.fgMuted, fontSize: 15, fontWeight: "700" },
});
