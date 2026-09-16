import { FIRST_OPEN_STORAGE_KEY } from "@/auth/guestPromptStorage";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, elevation, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

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
        const seen = await AsyncStorage.getItem(FIRST_OPEN_STORAGE_KEY);
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
      await AsyncStorage.setItem(FIRST_OPEN_STORAGE_KEY, "1");
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
            Point at anything with a name on it. Public brand: the ticker. Private brand: the
            closest public comparable and an ETF that holds it. Every result travels with evidence.
          </Text>
          <Text style={styles.body}>
            Every find lands in your universe — the map of companies you've caught yourself.
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
            accessibilityLabel="Walk the map instead"
          >
            <Text style={styles.secondaryText}>Or walk the map</Text>
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
