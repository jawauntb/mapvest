import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useHasFirstFind } from "@/finds/useHasFirstFind";
import { colors, radii } from "@/theme/tokens";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

const LOCKED_TITLE = "Comes with your first find";
const LOCKED_BODY = "Point at anything with a name on it. Every result travels with evidence.";
const LOCKED_CTA = "Point at anything with a name on it";

/**
 * Compact lock panel for comps / news / brief. Same EmptyState the rest of
 * the app uses; CTA always routes to Camera.
 */
export function FirstFindLockedPanel() {
  const router = useRouter();
  return (
    <View
      style={styles.panel}
      accessibilityRole="summary"
      accessibilityLabel="Locked until your first find"
    >
      <EmptyState icon="lock-closed-outline" title={LOCKED_TITLE} subtitle={LOCKED_BODY}>
        <PrimaryButton
          label={LOCKED_CTA}
          onPress={() => router.push("/(tabs)/camera")}
          accessibilityLabel={LOCKED_CTA}
          style={styles.cta}
        />
      </EmptyState>
    </View>
  );
}

/** Renders children only after the first successful identify. */
export function FirstFindSectionGate({ children }: { children: ReactNode }) {
  const { unlocked } = useHasFirstFind();
  if (!unlocked) return <FirstFindLockedPanel />;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.bgElevated,
  },
  cta: { alignSelf: "stretch", marginTop: 4 },
});
