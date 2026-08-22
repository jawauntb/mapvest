/**
 * LocalEconomyBriefCard — home-screen widget that reads the current area's
 * economic character in three FT-style paragraphs.
 *
 * Lifecycle (matches product requirement):
 *   0. Collapsed launcher row — nothing is fetched until the user taps in.
 *      Briefs generate on demand only, so the user can ask for one whenever
 *      they land in a new locale throughout the day (and save the ones they
 *      want to keep).
 *   1. "Getting your location…"        (permission + coords)
 *   2. "Researching your area…"        (POST /v1/local-brief in-flight)
 *   3. "Almost there…"                 (still pending after 3s)
 *   4. Error → visible retry button
 *
 * Presentation:
 *   • Drop-cap on ¶1's first letter
 *   • Serif body (Georgia), generous line-height
 *   • Chevron header closes the card back down to the launcher row
 *   • Save button → modal for label → confirmation toast (Alert.alert)
 *   • Small footer: "Read from N nearby businesses · sources cited · research, not advice · <ts>"
 */

import { type LocalBriefResponse, fetchLocalBrief, saveLocalBrief } from "@/api/local-brief";
import { heartbeatLocation } from "@/notif/prefs";
import { colors, fonts, radii, type } from "@/theme/tokens";
import { hapticSelect, hapticSuccess } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useFocusEffect } from "expo-router";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
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

type Coords = { lat: number; lng: number };

/** Mirrors the server's MOVE_METERS_THRESHOLD — a new area is a new brief. */
const MOVE_METERS_THRESHOLD = 2000;
/** Foreground flaps (control center, permission sheets) collapse into one check. */
const MOVE_CHECK_MIN_INTERVAL_MS = 30_000;
/** How far the map camera must travel before it takes the brief back from a
 *  detected physical move (small camera settles on tab-open don't count). */
const MAP_RECLAIM_METERS = 250;

/** Great-circle meters. Local copy — map.tsx / list.tsx keep their own. */
function haversineMeters(a: Coords, b: Coords): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Read or request foreground location, then resolve coords. */
async function resolveLocation(request: boolean): Promise<LocState> {
  const { status } = request
    ? await Location.requestForegroundPermissionsAsync()
    : await Location.getForegroundPermissionsAsync();
  if (status !== "granted") return { kind: "denied" };
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return {
    kind: "ready",
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
  };
}

function BriefChrome({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.eyebrowCluster}>
          <Text style={styles.eyebrow}>Local Economy Brief</Text>
          <View style={styles.exclusiveChip}>
            <Text style={styles.exclusiveChipText}>Only on Mapvest</Text>
          </View>
        </View>
        {actions ? <View style={styles.headerActions}>{actions}</View> : null}
      </View>
      {children}
    </View>
  );
}

type MapRegion = { latitude: number; longitude: number };

export function LocalEconomyBriefCard({ token }: { token: string | undefined }) {
  // Cache-only read of the map tab's last region. Map writes via
  // setQueryData; we never fetch. A missing queryFn used to throw a
  // fatal JS error on Home (and abort TestFlight release builds).
  const mapRegion = useQuery<MapRegion | undefined>({
    queryKey: ["tab-state", "map-region"],
    queryFn: () => undefined,
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  }).data;
  // On-demand: the card starts as a launcher row and generates nothing until
  // the user taps into it.
  const [expanded, setExpanded] = useState(false);
  const [loc, setLoc] = useState<LocState>({ kind: "idle" });
  const [settingsHint, setSettingsHint] = useState(false);
  const [slowLabel, setSlowLabel] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  /** Fresh fix taken on foreground/focus when the user moved out of the area
   *  the visible brief describes. Wins over the map tab's cached region. */
  const [movedFix, setMovedFix] = useState<Coords | null>(null);

  // Resolve current coordinates once the user taps in — nothing runs while the
  // launcher is closed. Other screens (map/list/camera) already request
  // permission; we only *read* the current grant here so we don't
  // double-prompt. The empty state offers an explicit Enable button that
  // calls requestForegroundPermissionsAsync.
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    (async () => {
      setLoc({ kind: "checking" });
      try {
        const next = await resolveLocation(false);
        if (!cancelled) setLoc(next);
      } catch {
        if (!cancelled) setLoc({ kind: "denied" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded]);

  async function enableLocation() {
    hapticSelect();
    setLoc({ kind: "checking" });
    try {
      const next = await resolveLocation(true);
      setLoc(next);
      setSettingsHint(next.kind === "denied");
    } catch {
      setLoc({ kind: "denied" });
      setSettingsHint(true);
    }
  }

  const mapLat = mapRegion && Number.isFinite(mapRegion.latitude) ? mapRegion.latitude : undefined;
  const mapLng =
    mapRegion && Number.isFinite(mapRegion.longitude) ? mapRegion.longitude : undefined;
  const mapCoords: Coords | null =
    mapLat !== undefined && mapLng !== undefined ? { lat: mapLat, lng: mapLng } : null;

  // A move detected on foreground outranks the map tab's cached camera — that
  // stale region is exactly what pinned the brief to wherever the app was last
  // opened. Released again once the user pans the map somewhere new.
  const coords: Coords | null =
    movedFix ?? mapCoords ?? (loc.kind === "ready" ? { lat: loc.lat, lng: loc.lng } : null);

  // Heartbeat the resolved coords to the push scheduler once per mount —
  // powers the "you moved to a new area" local-brief notification.
  const heartbeatSent = useRef(false);
  const lat = coords?.lat;
  const lng = coords?.lng;
  useEffect(() => {
    if (heartbeatSent.current || !token || lat === undefined || lng === undefined) return;
    heartbeatSent.current = true;
    heartbeatLocation(lat, lng, token).catch(() => {});
  }, [token, lat, lng]);

  // Generate on demand only — the query never runs until the user taps in.
  const enabled = expanded && !!token && !!coords;

  const briefQ = useQuery<LocalBriefResponse>({
    queryKey: coords
      ? ["local-brief", coords.lat.toFixed(3), coords.lng.toFixed(3)]
      : ["local-brief", "idle"],
    queryFn: () =>
      fetchLocalBrief(
        {
          lat: coords?.lat ?? 0,
          lng: coords?.lng ?? 0,
        },
        { token },
      ),
    enabled,
    // Server caches per-day; a longer client stale window absorbs re-renders.
    staleTime: 6 * 60 * 60 * 1000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 6000),
  });

  // ---- Foreground staleness (roadmap B1) --------------------------------
  // The brief the user is reading was fetched for these coordinates. Remember
  // them so a later fix can be measured against the brief itself, not against
  // whatever `coords` currently resolves to.
  const briefCoords = useRef<Coords | null>(null);
  useEffect(() => {
    if (briefQ.data && lat !== undefined && lng !== undefined) {
      briefCoords.current = { lat, lng };
    }
  }, [briefQ.data, lat, lng]);

  const checkInFlight = useRef(false);
  const lastCheckAt = useRef(0);
  const mapAnchorAtMove = useRef<Coords | null>(null);

  /** One position read per activation: bail if another is running, if we ran
   *  within the debounce window, or if there's no brief to compare against. */
  const checkForMove = useCallback(async () => {
    const anchor = briefCoords.current;
    if (!expanded || !token || !anchor || checkInFlight.current) return;
    const now = Date.now();
    if (now - lastCheckAt.current < MOVE_CHECK_MIN_INTERVAL_MS) return;
    checkInFlight.current = true;
    lastCheckAt.current = now;
    try {
      const next = await resolveLocation(false);
      if (next.kind !== "ready") return;
      const fix = { lat: next.lat, lng: next.lng };
      if (haversineMeters(fix, anchor) <= MOVE_METERS_THRESHOLD) return;
      // New coordinates ⇒ new query key ⇒ React Query fetches the new area's
      // brief on its own; no manual refetch (and no visual change) needed.
      mapAnchorAtMove.current =
        mapLat !== undefined && mapLng !== undefined ? { lat: mapLat, lng: mapLng } : null;
      setLoc(next);
      setMovedFix(fix);
    } catch {
      // Keep showing the brief we have; the next activation tries again.
    } finally {
      checkInFlight.current = false;
    }
  }, [expanded, token, mapLat, mapLng]);

  // Cold "active" transitions only — iOS fires change events for control
  // center pulls and permission sheets that never left the foreground.
  const appState = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const prev = appState.current;
      appState.current = next;
      if (next === "active" && prev !== "active") void checkForMove();
    });
    return () => sub.remove();
  }, [checkForMove]);

  // Covers moving with the app open and coming back to Home from another tab.
  // Shares the debounce with the AppState path, so the two never double-fetch.
  useFocusEffect(
    useCallback(() => {
      void checkForMove();
    }, [checkForMove]),
  );

  // An intentional map pan takes the brief back from the detected move.
  useEffect(() => {
    if (!movedFix || mapLat === undefined || mapLng === undefined) return;
    const region = { lat: mapLat, lng: mapLng };
    const anchor = mapAnchorAtMove.current;
    if (!anchor) {
      mapAnchorAtMove.current = region;
      return;
    }
    if (haversineMeters(region, anchor) > MAP_RECLAIM_METERS) setMovedFix(null);
  }, [mapLat, mapLng, movedFix]);

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
      if (!coords || !briefQ.data) throw new Error("no brief");
      const label = labelDraft.trim();
      if (!label) throw new Error("label required");
      const briefText = briefQ.data.paragraphs.join("\n\n");
      return saveLocalBrief(
        {
          label,
          lat: coords.lat,
          lng: coords.lng,
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
    const defaultLabel = [
      briefQ.data.place.neighborhood,
      briefQ.data.place.city,
      briefQ.data.place.state,
    ]
      .filter(Boolean)
      .join(", ");
    setLabelDraft(defaultLabel || "My spot");
    setSaveOpen(true);
  }

  // Closed launcher — the whole module is one tappable row until the user
  // asks for a brief. Tapping in kicks off location + generation.
  if (!expanded) {
    return (
      <Pressable
        onPress={() => {
          hapticSelect();
          setExpanded(true);
        }}
        style={styles.launcher}
        accessibilityRole="button"
        accessibilityLabel="Open Local Economy Brief — researches the economy where you are"
      >
        <View style={{ flex: 1, gap: 3 }}>
          <View style={styles.eyebrowCluster}>
            <Text style={styles.eyebrow}>Local Economy Brief</Text>
            <View style={styles.exclusiveChip}>
              <Text style={styles.exclusiveChipText}>Only on Mapvest</Text>
            </View>
          </View>
          <Text style={styles.launcherHint}>
            Tap for a live read on the economy wherever you are.
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.fgMuted} />
      </Pressable>
    );
  }

  // Locked out when either signed-out or permission-denied — featured chrome
  // stays so the module is still visible. Guests get a one-line pitch;
  // denied location gets an in-app Enable button before Settings copy.
  if (!token) {
    return (
      <BriefChrome>
        <Text style={styles.mutedBody}>
          Sign in to read a live brief on the economy of wherever you're standing.
        </Text>
      </BriefChrome>
    );
  }
  if (loc.kind === "denied" && !mapRegion) {
    return (
      <BriefChrome>
        <Text style={styles.mutedBody}>
          {settingsHint
            ? "Location is still off — enable it in Settings to see the area brief."
            : "Location access is off — enable it to see the area brief."}
        </Text>
        <Pressable
          onPress={() => {
            void enableLocation();
          }}
          style={[styles.retryBtn, { alignSelf: "flex-start" }]}
          accessibilityRole="button"
          accessibilityLabel="Enable location"
        >
          <Ionicons name="location-outline" size={14} color={colors.accentInk} />
          <Text style={styles.retryText}>Enable location</Text>
        </Pressable>
      </BriefChrome>
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
    <BriefChrome
      actions={
        <>
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
          {/* Always-visible refresh — works after a successful load too.
              Server never caches outage briefs, but a successful outage-body
              200 is cached client-side for 6h; refetch forces a re-run. */}
          <Pressable
            onPress={() => {
              hapticSelect();
              if (!coords) return;
              void briefQ.refetch();
            }}
            hitSlop={10}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Refresh brief"
            disabled={briefQ.isFetching || !coords}
          >
            <Ionicons
              name="refresh"
              size={16}
              color={briefQ.isFetching ? colors.fgDim : colors.accent}
            />
            <Text
              style={[styles.headerBtnText, briefQ.isFetching ? { color: colors.fgDim } : null]}
            >
              Refresh
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              hapticSelect();
              setExpanded(false);
            }}
            hitSlop={10}
            style={styles.chevronBtn}
            accessibilityRole="button"
            accessibilityLabel="Close local brief"
            accessibilityState={{ expanded: true }}
          >
            <Ionicons name="chevron-up" size={16} color={colors.fgMuted} />
          </Pressable>
        </>
      }
    >
      {busy ? (
        <View style={styles.busyBlock}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.busyLabel}>{statusLabel}</Text>
        </View>
      ) : briefQ.isError ||
        // Outage-body detection. The API returns a 200 with a stub payload
        // when Exa / OpenRouter / Nominatim flakes — treat it like an error
        // in the UI so the user sees "Retry" instead of the sad stub.
        (briefQ.data?.paragraphs?.[0] ?? "").startsWith(
          "The Local Economy Brief service is temporarily unavailable",
        ) ? (
        <View style={styles.busyBlock}>
          <Text style={styles.errorLabel}>
            {briefQ.isError ? "Couldn't load the brief." : "Research service was busy — try again."}
          </Text>
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
            {briefQ.data.nearbyCount > 0
              ? `Read from ${briefQ.data.nearbyCount} nearby business${
                  briefQ.data.nearbyCount === 1 ? "" : "es"
                }`
              : "Read from your area"}
            {" · sources cited · research, not advice · "}
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
            <Text style={styles.modalHint}>Give this brief a label so you can find it later.</Text>
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
    </BriefChrome>
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
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
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
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional
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
    borderColor: colors.accentMuted,
    backgroundColor: colors.bgElevated,
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  /** Closed on-demand state — one tappable row, no fetching behind it. */
  launcher: {
    marginHorizontal: 16,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.accentMuted,
    backgroundColor: colors.bgElevated,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  launcherHint: { color: colors.fgMuted, fontSize: 12, lineHeight: 17 },
  eyebrowCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
    flexWrap: "wrap",
  },
  exclusiveChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.bgSunken,
  },
  exclusiveChipText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
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
    fontFamily: fonts.serif,
    fontSize: 42,
    lineHeight: 42,
    fontWeight: "700",
    marginRight: 2,
    marginTop: -2,
  },
  body: {
    color: colors.fg,
    fontFamily: fonts.serif,
    fontSize: 15,
    lineHeight: 24,
  },
  /** Optional ¶4 closer — smaller, lighter, italic to read as an outlook. */
  bodyOutlook: {
    color: colors.fgMuted,
    fontFamily: fonts.serif,
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
