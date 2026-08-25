import { ScalePressable } from "@/components/ScalePressable";
import {
  type LocationContextState,
  locationContextDescription,
  locationContextLabel,
  shouldShowLocationContextNotice,
} from "@/location/locationContext";
import { colors, radii, type } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

export function LocationContextNotice({
  state,
  busy,
  compact = false,
  onAction,
}: {
  state: LocationContextState;
  busy: boolean;
  compact?: boolean;
  onAction?: () => void;
}) {
  if (!shouldShowLocationContextNotice(state) && !busy) return null;

  const denied = state.kind === "permission-denied";
  const retryable = state.kind === "unavailable";
  const showAction = state.kind !== "loading" && onAction;
  const icon: keyof typeof Ionicons.glyphMap = denied
    ? "location-outline"
    : state.kind === "map-area"
      ? "map-outline"
      : "navigate-outline";

  return (
    <View style={[styles.root, compact && styles.compact]}>
      <Ionicons name={icon} size={17} color={denied ? colors.warn : colors.accent} />
      <View style={styles.copy}>
        <Text style={styles.label}>{locationContextLabel(state)}</Text>
        <Text style={styles.description}>{locationContextDescription(state)}</Text>
      </View>
      {busy ? <ActivityIndicator color={colors.fg} size="small" /> : null}
      {!busy && showAction ? (
        <ScalePressable
          onPress={onAction}
          hitSlop={5}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={
            denied
              ? "Open location settings"
              : retryable
                ? "Try again to get your location"
                : "Use my location"
          }
        >
          <Text style={styles.actionText}>
            {denied ? "Open Settings" : retryable ? "Try again" : "Use my location"}
          </Text>
        </ScalePressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    ...{
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
    },
  },
  compact: { marginHorizontal: 12, marginBottom: 4 },
  copy: { flex: 1, minWidth: 0 },
  label: { color: colors.fg, ...type.label },
  description: { color: colors.fgMuted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  action: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minHeight: 44,
    justifyContent: "center",
  },
  actionText: { color: colors.accent, fontSize: 12, fontWeight: "700" },
});
