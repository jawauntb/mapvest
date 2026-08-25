import { fetchNewsRead } from "@/api/news";
import { colors, fonts, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = {
  url: string;
  title?: string;
  source?: string;
  visible: boolean;
  onClose: () => void;
};

export function InAppReader({ url, title, source, visible, onClose }: Props) {
  const q = useQuery({
    queryKey: ["news-read", url],
    queryFn: () => fetchNewsRead(url),
    enabled: visible && !!url,
    staleTime: 30 * 60_000,
    retry: 1,
  });

  const paragraphs = useMemo(() => {
    const raw = q.data?.text?.trim() ?? "";
    if (!raw) return [];
    return raw
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }, [q.data?.text]);

  const headline = q.data?.title?.trim() || title?.trim() || "Article";

  function openSafari() {
    hapticSelect();
    Linking.openURL(url).catch(() => {
      /* invalid scheme */
    });
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.toolbar}>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            style={styles.toolBtn}
            accessibilityRole="button"
            accessibilityLabel="Close reader"
          >
            <Ionicons name="close" size={22} color={colors.fg} />
          </Pressable>
          <Text style={styles.toolTitle} numberOfLines={1}>
            {source || "Reader"}
          </Text>
          <Pressable
            onPress={openSafari}
            hitSlop={10}
            style={styles.safariBtn}
            accessibilityRole="button"
            accessibilityLabel="Open in Safari"
          >
            <Ionicons name="compass-outline" size={16} color={colors.accent} />
            <Text style={styles.safariText}>Safari</Text>
          </Pressable>
        </View>

        {q.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.muted}>Loading reader view…</Text>
          </View>
        ) : paragraphs.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.headline}>{headline}</Text>
            <Text style={styles.muted}>Couldn't load a reader view.</Text>
            <Pressable onPress={openSafari} style={styles.retry} accessibilityRole="button">
              <Text style={styles.retryText}>Open in Safari</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <Text style={styles.headline}>{headline}</Text>
            {source ? <Text style={styles.byline}>{source}</Text> : null}
            {paragraphs.map((p) => (
              <Text key={p.slice(0, 48)} style={styles.p}>
                {p}
              </Text>
            ))}
            <Pressable onPress={openSafari} style={styles.footerLink} accessibilityRole="link">
              <Text style={styles.footerLinkText}>Open original in Safari</Text>
            </Pressable>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  toolBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  toolTitle: { flex: 1, color: colors.fgMuted, fontSize: 13, fontWeight: "700" },
  safariBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accentMuted,
  },
  safariText: { color: colors.accent, fontSize: 12, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  body: { padding: 20, gap: 14, paddingBottom: 40 },
  headline: {
    color: colors.fg,
    fontFamily: fonts.serif,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "700",
  },
  byline: { color: colors.fgMuted, fontSize: 12, fontWeight: "600" },
  p: { color: colors.fg, fontFamily: fonts.serif, fontSize: 17, lineHeight: 26 },
  muted: { color: colors.fgMuted, fontSize: 14, textAlign: "center" },
  retry: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  retryText: { color: colors.accentInk, fontWeight: "700", fontSize: 13 },
  footerLink: { marginTop: 8, paddingVertical: 8 },
  footerLinkText: { color: colors.accent, fontSize: 13, fontWeight: "600" },
});
