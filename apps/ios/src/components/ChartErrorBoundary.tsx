import { colors, radii } from "@/theme/tokens";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Charts must never take down the Investable sheet. A bad auction/ridge
 * payload used to blank the whole page; this keeps the header, quote, and
 * actions up and lets the user retry just the chart. Native SVG crashes are
 * avoided by drawing with Views (`chartkit/view-svg.tsx`) instead of
 * react-native-svg.
 */
export class ChartErrorBoundary extends Component<
  {
    children: ReactNode;
    title?: string;
    detail?: string;
    retryLabel?: string;
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[charts] render failed", error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const title = this.props.title ?? "Chart failed to render";
      const detail =
        this.props.detail ??
        "The rest of this page is still usable. Retry the chart, or pick another view.";
      const retryLabel = this.props.retryLabel ?? "Retry chart";
      return (
        <View style={styles.box}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.detail}>{detail}</Text>
          <Pressable
            onPress={() => this.setState({ error: null })}
            style={styles.retry}
            accessibilityRole="button"
            accessibilityLabel={retryLabel}
          >
            <Text style={styles.retryText}>{retryLabel}</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 12,
    gap: 8,
  },
  title: { color: colors.danger, fontSize: 13, fontWeight: "700" },
  detail: { color: colors.fgMuted, fontSize: 12, lineHeight: 17 },
  retry: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 30,
    justifyContent: "center",
  },
  retryText: { color: colors.accent, fontSize: 12, fontWeight: "600" },
});
