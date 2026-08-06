import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

/**
 * Photo chart viewer: inline preview, fullscreen pinch-zoom, Save PNG.
 * Used for every Underlying Analyzer PNG (auction / regression / …).
 */
export function ChartMedia({
  uri,
  filename,
  accessibilityLabel,
}: {
  uri: string;
  /** Suggested download name, e.g. `SBUX-auction-1mo.png` */
  filename: string;
  accessibilityLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const savePng = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const base64 = uri.includes(",") ? uri.split(",")[1]! : uri;
      const safe = filename.replace(/[^\w.-]+/g, "_");
      const path = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${safe}`;
      await FileSystem.writeAsStringAsync(path, base64, {
        encoding: "base64",
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: "image/png",
          dialogTitle: "Save chart PNG",
          UTI: "public.png",
        });
      } else {
        Alert.alert("Saved", `Chart written to ${path}`);
      }
    } catch (e) {
      Alert.alert("Save failed", e instanceof Error ? e.message : "Could not save chart");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <Text style={styles.hint}>Tap to expand · pinch to zoom</Text>
        <View style={styles.toolbarBtns}>
          <Pressable
            onPress={() => setOpen(true)}
            style={({ pressed }) => [styles.toolBtn, pressed && styles.pressed]}
            accessibilityLabel="Expand chart"
          >
            <Text style={styles.toolBtnText}>Expand</Text>
          </Pressable>
          <Pressable
            onPress={() => void savePng()}
            disabled={saving}
            style={({ pressed }) => [styles.toolBtn, pressed && styles.pressed]}
            accessibilityLabel="Save chart as PNG"
          >
            {saving ? (
              <ActivityIndicator color="#3ECF8E" />
            ) : (
              <Text style={styles.toolBtnText}>Save PNG</Text>
            )}
          </Pressable>
        </View>
      </View>

      <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton">
        <ScrollView
          style={styles.inlineZoom}
          contentContainerStyle={styles.zoomContent}
          maximumZoomScale={4}
          minimumZoomScale={1}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          centerContent
          bouncesZoom
          nestedScrollEnabled
        >
          <Image
            source={{ uri }}
            style={styles.inlineImg}
            resizeMode="contain"
            accessibilityLabel={accessibilityLabel}
          />
        </ScrollView>
      </Pressable>

      <Modal
        visible={open}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalBar}>
            <Pressable
              onPress={() => setOpen(false)}
              style={({ pressed }) => [styles.toolBtn, pressed && styles.pressed]}
            >
              <Text style={styles.toolBtnText}>Close</Text>
            </Pressable>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {accessibilityLabel}
            </Text>
            <Pressable
              onPress={() => void savePng()}
              disabled={saving}
              style={({ pressed }) => [styles.toolBtn, styles.toolBtnAccent, pressed && styles.pressed]}
            >
              {saving ? (
                <ActivityIndicator color="#0C0E10" />
              ) : (
                <Text style={[styles.toolBtnText, styles.toolBtnAccentText]}>Save PNG</Text>
              )}
            </Pressable>
          </View>
          <ScrollView
            ref={scrollRef}
            style={styles.modalZoom}
            contentContainerStyle={styles.modalZoomContent}
            maximumZoomScale={6}
            minimumZoomScale={1}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            centerContent
            bouncesZoom
          >
            <Image
              source={{ uri }}
              style={styles.modalImg}
              resizeMode="contain"
              accessibilityLabel={accessibilityLabel}
            />
          </ScrollView>
          <Text style={styles.modalHint}>Pinch to zoom · drag to pan</Text>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  toolbarBtns: { flexDirection: "row", gap: 6 },
  hint: { color: "#666", fontSize: 11, flex: 1 },
  toolBtn: {
    borderWidth: 1,
    borderColor: "#2a6b45",
    backgroundColor: "#0d2818",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 72,
    alignItems: "center",
  },
  toolBtnAccent: {
    backgroundColor: "#3ECF8E",
    borderColor: "#3ECF8E",
  },
  toolBtnText: { color: "#3ECF8E", fontSize: 12, fontWeight: "700" },
  toolBtnAccentText: { color: "#0C0E10" },
  pressed: { opacity: 0.75 },
  inlineZoom: {
    width: "100%",
    height: 280,
    borderRadius: 12,
    backgroundColor: "#050505",
    borderWidth: 1,
    borderColor: "#222",
  },
  zoomContent: { alignItems: "center", justifyContent: "center", minHeight: 280 },
  inlineImg: { width: "100%", height: 260 },
  modalRoot: { flex: 1, backgroundColor: "#050505", paddingTop: 54 },
  modalBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 8,
  },
  modalTitle: { color: "#ccc", fontSize: 13, flex: 1, textAlign: "center" },
  modalZoom: { flex: 1 },
  modalZoomContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100%",
  },
  modalImg: { width: "100%", height: 520 },
  modalHint: {
    color: "#666",
    fontSize: 11,
    textAlign: "center",
    paddingVertical: 12,
    paddingBottom: 28,
  },
});
