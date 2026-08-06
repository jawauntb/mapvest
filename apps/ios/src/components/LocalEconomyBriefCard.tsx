/**
 * LocalEconomyBriefCard — home-screen widget that reads the current area's
 * economic character in three FT-style paragraphs.
 *
 * Lifecycle (matches product requirement):
 *   1. "Getting your location…"        (permission + coords)
 *   2. "Researching your area…"        (POST /v1/local-brief in-flight)
 *   3. "Almost there…"                 (still pending after 3s)
 *   4. Error → visible retry button
 *
 * Presentation:
 *   • Drop-cap on ¶1's first letter
 *   • Serif body (Georgia), generous line-height
 *   • Collapsible chevron header (mirrors home.tsx `wlCollapsed` pattern)
 *   • Save button → modal for label → confirmation toast (Alert.alert)
 *   • Small footer: "based on N nearby brands · sourced from Exa · <ts>"
 */

import {
  fetchLocalBrief,
  saveLocalBrief,
  type LocalBriefResponse,
} from "@/api/local-brief";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect, hapticSuccess } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type LocState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "denied" }
  | { kind: "ready"; lat: number; lng: number };

export function LocalEconomyBriefCard({ token }: { token: string | undefined }) {
  const [collapsed, setCollapsed] = useState(false);
  const [loc, setLoc] = useState<LocState>({ kind: "idle" });
  const [slowLabel, setSlowLabel] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");

  // Resolve current coordinates on mount. Other screens (map/list/camera)
  // already request permission; we only *read* the current grant here so we
  // don't double-prompt. If access isn't granted, show an empty state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoc({ kind: "checking" });
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") {
          if (!cancelled) setLoc({ kind: "denied" });
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        setLoc({
          kind: "ready",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      } catch {
        if (!cancelled) setLoc({ kind: "denied" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enabled =
    !!token && loc.kind === "ready" && Number.isFinite(loc.lat) && Number.isFinite(loc.lng);

  const briefQ = useQuery<LocalBriefResponse>({
    queryKey:
      loc.kind === "ready"
        ? ["local-brief", loc.lat.toFixed(3), loc.lng.toFixed(3)]
        : ["local-brief", "idle"],
    queryFn: () =>
      fetchLocalBrief(
        {
          lat: loc.kind === "ready" ? loc.lat : 0,
          lng: loc.kind === "ready" ? loc.lng : 0,
        },
        { token },
      ),
    enabled,
    // Server caches per-day; a longer client stale window absorbs re-renders.
    staleTime: 6 * 60 * 60 * 1000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 6000),
  });

  // "Almost there…" copy after 3s while the query is still pending.
  useEffect(() => {
    if (!briefQ.isFetching) {
      setSlowLabel(false);
      return;
    }
    const t = setTimeout(() => setSlowLabel(true), 3000);
    return () => clearTimeout(t);
  }, [briefQ.isFetching]);

  const saveM = useMutation({
    mutationFn: () => {
      if (!token) throw new Error("no session");
      if (loc.kind !== "ready" || !briefQ.data) throw new Error("no brief");
      const label = labelDraft.trim();
      if (!label) throw new Error("label required");
      const briefText = briefQ.data.paragraphs.join("\n\n");
      return saveLocalBrief(
        {
          label,
          lat: loc.lat,
          lng: loc.lng,
          brief: briefText,
          place: briefQ.data.place,
        },
        { token },
      );
    },
    onSuccess: () => {
      hapticSuccess();
      setSaveOpen(false);
      Alert.alert("Saved", "This brief is now in your Location folder.");
    },
    onError: (err) => {
      Alert.alert("Couldn't save", (err as Error).message || "Try again.");
    },
  });

  function openSaveModal() {
    if (!briefQ.data) return;
    hapticSelect();
    const defaultLabel = [briefQ.data.place.city, briefQ.data.place.state]
      .filter(Boolean)
      .join(", ");
    setLabelDraft(defaultLabel || "My spot");
    setSaveOpen(true);
  }

  // Locked out when either signed-out or permission-denied — same restrained
  // "sign in / grant access" empty-state treatment as the rest of the app.
  if (!token) {
    return (
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Local Economy Brief</Text>
        <Text style={styles.mutedBody}>Sign in to read the economic character of where you are.</Text>
      </View>
    );
  }
  if (loc.kind === "denied") {
    return (
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Local Economy Brief</Text>
        <Text style={styles.mutedBody}>
          Location access is off — enable it in Settings to see the area brief.
        </Text>
      </View>
    );
  }

  const busy =
    loc.kind === "idle" ||
    loc.kind === "checking" ||
    (enabled && briefQ.isFetching && !briefQ.data);

  const statusLabel = (() => {
    if (loc.kind === "idle" || loc.kind === "checking") return "Getting your location…";
    if (briefQ.isFetching && !briefQ.data)
      return slowLabel ? "Almost there…" : "Researching your area…";
    return "";
  })();

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.eyebrow}>Local Economy Brief</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {briefQ.data ? (
            <Pressable
              onPress={openSaveModal}
              hitSlop={10}
              style={styles.headerBtn}
              accessibilityRole="button"
              accessibilityLabel="Save this brief to your Location folder"
            >
              <Ionicons name="bookmark-outline" size={16} color={colors.accent} />
              <Text style={styles.headerBtnText}>Save</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => {
              hapticSelect();
              setCollapsed((v) => !v);
            }}
            hitSlop={10}
            style={styles.chevronBtn}
            accessibilityRole="button"
            accessibilityLabel={collapsed ? "Expand local brief" : "Collapse local brief"}
            accessibilityState={{ expanded: !collapsed }}
          >
            <Ionicons
              name={collapsed ? "chevron-down" : "chevron-up"}
              size={16}
              color={colors.fgMuted}
            />
          </Pressable>
        </View>
      </View>

      {collapsed ? null : busy ? (
        <View style={styles.busyBlock}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.busyLabel}>{statusLabel}</Text>
        </View>
      ) : briefQ.isError ? (
        <View style={styles.busyBlock}>
          <Text style={styles.errorLabel}>Couldn't load the brief.</Text>
          <Pressable
            onPress={() => {
              hapticSelect();
              void briefQ.refetch();
            }}
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel="Retry Local Economy Brief"
          >
            <Ionicons name="refresh" size={14} color={colors.accentInk} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : briefQ.data ? (
        <>
          <BriefBody paragraphs={briefQ.data.paragraphs} />
          <Text style={styles.footer}>
            based on {briefQ.data.nearbyCount} nearby brand
            {briefQ.data.nearbyCount === 1 ? "" : "s"} · sourced from Exa ·{" "}
            {new Date(briefQ.data.generatedAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
        </>
      ) : null}

      {/* Save modal — plain <Modal> to match the sidebar / alerts pattern. */}
      <Modal
        visible={saveOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setSaveOpen(false)}
      >
        <Pressable style={styles.modalScrim} onPress={() => setSaveOpen(false)}>
          <Pressable
            style={styles.modalCard}
            onPress={(e) => e.stopPropagation()}
            // Pressable-inside-Pressable pattern prevents scrim taps from
            // reaching the card while still allowing card taps to work.
          >
            <Text style={styles.modalTitle}>Save to Location folder</Text>
            <Text style={styles.modalHint}>
              Give this brief a label so you can find it later.
            </Text>
            <TextInput
              value={labelDraft}
              onChangeText={setLabelDraft}
              placeholder="e.g. Downtown Denver"
              placeholderTextColor={colors.fgDim}
              style={styles.modalInput}
              autoFocus
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={() => saveM.mutate()}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setSaveOpen(false)}
                style={[styles.modalBtn, styles.modalBtnGhost]}
                accessibilityRole="button"
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => saveM.mutate()}
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                disabled={!labelDraft.trim() || saveM.isPending}
                accessibilityRole="button"
              >
                <Text style={styles.modalBtnPrimaryText}>
                  {saveM.isPending ? "Saving…" : "Save"}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/** Labels the LLM is contracted to emit inside ¶3 (see local-brief-generator
 *  system prompt). Detected here so we can render each on its own line with
 *  the label rendered in the accent color — no bullets, no markdown, still
 *  clean plain text. Kept in sync with the server prompt. */
const THOC_LABELS = ["Tailwinds", "Headwinds", "Opportunities", "Challenges"] as const;
const THOC_REGEX = /^(Tailwinds|Headwinds|Opportunities|Challenges):\s+(.+)$/;

/**
 * N-paragraph body (3 or 4) with a manual drop-cap on the first letter of ¶1.
 * Paragraph 3 typically embeds the Tailwinds/Headwinds/Opportunities/Challenges
 * label block on separate lines — we detect those and style the labels; other
 * lines render as plain sentences. Paragraph 4 (if present) is the optional
 * closing brand-exposure sentence — rendered smaller/lighter as an outlook
 * footer style.
 */
function BriefBody({ paragraphs }: { paragraphs: string[] }) {
  const first = paragraphs[0] ?? "";
  const dropChar = first.charAt(0);
  const firstRest = first.slice(1);
  return (
    <View style={styles.bodyWrap}>
      {/* ¶1 — drop cap */}
      <View style={styles.p1Row}>
        <Text style={styles.dropCap}>{dropChar}</Text>
        <Text style={[styles.body, { flex: 1 }]}>{firstRest}</Text>
      </View>
      {/* ¶2..N */}
      {paragraphs.slice(1).map((p, i) => {
        const isLast = i === paragraphs.length - 2;
        const isOutlookCloser = paragraphs.length >= 4 && isLast;
        return (
          // Paragraphs are positional; index is stable within a single brief.
          // biome-ignore lint/suspicious/noArrayIndexKey: stable positional list
          <ParagraphBlock key={i} text={p} outlook={isOutlookCloser} />
        );
      })}
    </View>
  );
}

/**
 * Renders one paragraph. If any lines match the T/H/O/C label pattern we
 * split the paragraph into a lede prose block + a labeled outlook block.
 * The `outlook` flag downgrades typography for the optional ¶4 closer.
 */
function ParagraphBlock({ text, outlook }: { text: string; outlook: boolean }) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const labelStart = lines.findIndex((l) => THOC_REGEX.test(l));
  const bodyStyle = outlook ? styles.bodyOutlook : styles.body;

  if (labelStart === -1) {
    return <Text style={bodyStyle}>{text}</Text>;
  }

  const prose = lines.slice(0, labelStart).join(" ");
  const labeled = lines.slice(labelStart);
  return (
    <View style={{ gap: 8 }}>
      {prose ? <Text style={bodyStyle}>{prose}</Text> : null}
      <View style={styles.thocBlock}>
        {labeled.map((line, i) => {
          const m = line.match(THOC_REGEX);
          if (!m) {
            // biome-ignore lint/suspicious/noArrayIndexKey: positional
            return (
              <Text key={`x${i}`} style={bodyStyle}>
                {line}
              </Text>
            );
          }
          const [, label, rest] = m;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional
            <Text key={`t${i}`} style={styles.thocLine}>
              <Text style={styles.thocLabel}>{label}: </Text>
              <Text style={styles.thocBody}>{rest}</Text>
            </Text>
          );
        })}
      </View>
    </View>
  );
}

// Suppress "unused" for the label whitelist while keeping it in-file for future
// contributors reading the regex — the array documents contract intent.
void THOC_LABELS;

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  headerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accentMuted,
    backgroundColor: colors.bgSunken,
  },
  headerBtnText: { color: colors.accent, fontSize: 12, fontWeight: "700" },
  chevronBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  busyBlock: {
    paddingVertical: 20,
    alignItems: "center",
    gap: 10,
  },
  busyLabel: { color: colors.fgMuted, fontSize: 13, fontStyle: "italic" },
  errorLabel: { color: colors.fgMuted, fontSize: 13 },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  retryText: { color: colors.accentInk, fontWeight: "700", fontSize: 12 },
  mutedBody: { color: colors.fgMuted, fontSize: 13, lineHeight: 19 },
  bodyWrap: { gap: 10 },
  p1Row: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  dropCap: {
    color: colors.fg,
    fontFamily: "Georgia",
    fontSize: 42,
    lineHeight: 42,
    fontWeight: "700",
    marginRight: 2,
    marginTop: -2,
  },
  body: {
    color: colors.fg,
    fontFamily: "Georgia",
    fontSize: 15,
    lineHeight: 24,
  },
  /** Optional ¶4 closer — smaller, lighter, italic to read as an outlook. */
  bodyOutlook: {
    color: colors.fgMuted,
    fontFamily: "Georgia",
    fontStyle: "italic",
    fontSize: 13,
    lineHeight: 20,
  },
  /** Wraps the Tailwinds/Headwinds/Opportunities/Challenges labeled lines. */
  thocBlock: {
    gap: 4,
    marginTop: 2,
    paddingLeft: 6,
    borderLeftWidth: 2,
    borderLeftColor: colors.accentMuted,
  },
  thocLine: { fontSize: 13, lineHeight: 19, paddingLeft: 4 },
  thocLabel: {
    color: colors.accent,
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  thocBody: { color: colors.fgMuted },
  footer: {
    color: colors.fgDim,
    fontSize: 11,
    marginTop: 4,
  },
  modalScrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 10,
  },
  modalTitle: { color: colors.fg, ...type.h3, fontSize: 16 },
  modalHint: { color: colors.fgMuted, fontSize: 12 },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.fg,
    backgroundColor: colors.bgSunken,
    fontSize: 15,
    minHeight: 44,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 4,
  },
  modalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.md,
    minWidth: 88,
    alignItems: "center",
  },
  modalBtnGhost: { backgroundColor: colors.bgSunken },
  modalBtnGhostText: { color: colors.fgMuted, fontWeight: "600", fontSize: 14 },
  modalBtnPrimary: { backgroundColor: colors.accent },
  modalBtnPrimaryText: { color: colors.accentInk, fontWeight: "800", fontSize: 14 },
});
