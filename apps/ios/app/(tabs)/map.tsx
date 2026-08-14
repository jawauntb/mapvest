import { type Quote, fetchChart, fetchNearby, fetchQuotesMap } from "@/api/client";
import type { NearbyItem } from "@/api/types";
import { useSession } from "@/auth/session";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { openChatAbout } from "@/nav/chatAbout";
import { colors, radii } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { saveLastLocationForWidgets } from "@/widgets/widgetLocation";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BlurView } from "expo-blur";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";

const FALLBACK_REGION: Region = {
  latitude: 37.7749,
  longitude: -122.4194,
  latitudeDelta: 0.03,
  longitudeDelta: 0.03,
};

/** Fixed pin canvas — variable-height custom markers mis-anchor on Google Maps. */
const PIN_W = 104;
const PIN_H = 86;
const PIN_W_REVEALED = 128;
const PIN_H_REVEALED = 102;
const PLAIN_W = 28;
const PLAIN_H = 28;

/** ~meters between pins that count as overlapping for two-tap reveal. */
const OVERLAP_METERS = 55;

export default function MapScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const cachedRegion = qc.getQueryData<Region>(["tab-state", "map-region"]);
  const [region, setRegion] = useState<Region>(cachedRegion ?? FALLBACK_REGION);
  const [permErr, setPermErr] = useState<string | null>(null);
  /** Tracks until quotes render into the bitmap, then freezes for perf. */
  const [trackMarkers, setTrackMarkers] = useState(true);
  /** First tap on an overlapped cluster elevates this place; second opens detail. */
  const [focusedPlaceId, setFocusedPlaceId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (cachedRegion) return;
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setPermErr("Location permission denied. Showing San Francisco.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const next = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      };
      setRegion(next);
      qc.setQueryData(["tab-state", "map-region"], next);
      void saveLastLocationForWidgets({ lat: next.latitude, lng: next.longitude });
    })();
  }, [cachedRegion, qc]);

  const nearbyQuery = useQuery({
    queryKey: [
      "nearby",
      region.latitude.toFixed(3),
      region.longitude.toFixed(3),
      zoomBucket(region),
    ],
    queryFn: () =>
      fetchNearby(
        {
          lat: region.latitude,
          lng: region.longitude,
          radius: viewportRadiusM(region),
          limit: 50,
        },
        { token: session?.token },
      ),
    staleTime: 60_000,
  });

  const items = useMemo(() => {
    const raw = nearbyQuery.data?.items ?? [];
    const center = { lat: region.latitude, lng: region.longitude };
    return [...raw].sort(
      (a, b) =>
        haversineMeters(a.place.location, center) - haversineMeters(b.place.location, center),
    );
  }, [nearbyQuery.data, region.latitude, region.longitude]);
  const brandTickers = useMemo(() => brandTickerIndex(items), [items]);

  const pinTickers = useMemo(() => {
    const out: string[] = [];
    for (const item of items) {
      const t = resolvePinTicker(item, brandTickers);
      if (t) out.push(t.symbol);
    }
    return [...new Set(out)];
  }, [items, brandTickers]);

  const quotesQuery = useQuery({
    queryKey: ["map-quotes", pinTickers.join(",")],
    enabled: pinTickers.length > 0,
    queryFn: () => fetchQuotesMap(pinTickers, { token: session?.token }),
    staleTime: 60_000,
  });

  const quotes = quotesQuery.data ?? {};

  useEffect(() => {
    setTrackMarkers(true);
    const delay = quotesQuery.isFetching ? 1600 : 700;
    const t = setTimeout(() => setTrackMarkers(false), delay);
    return () => clearTimeout(t);
  }, [items, quotesQuery.isFetching, quotesQuery.dataUpdatedAt, focusedPlaceId]);

  useEffect(() => {
    for (const t of pinTickers.slice(0, 4)) {
      void qc.prefetchQuery({
        queryKey: ["chart", t, "auction", "1mo"],
        queryFn: () => fetchChart("auction", t, "1mo", { token: session?.token }),
        staleTime: 10 * 60_000,
      });
    }
  }, [pinTickers, qc, session?.token]);

  function openItem(item: NearbyItem) {
    const pin = resolvePinTicker(item);
    const id = pin?.symbol ?? item.place.name;
    router.push(`/detail/${encodeURIComponent(id)}`);
  }

  /**
   * Overlapped pins: first tap elevates/reveals the whole tooltip; second tap
   * (same focused pin) opens the summary. Solo pins open immediately.
   */
  function onPinPress(item: NearbyItem) {
    hapticSelect();
    const cluster = items.filter(
      (other) =>
        other.place.id === item.place.id ||
        haversineMeters(item.place.location, other.place.location) <= OVERLAP_METERS,
    );
    const overlapped = cluster.length > 1;
    if (overlapped && focusedPlaceId !== item.place.id) {
      setFocusedPlaceId(item.place.id);
      return;
    }
    setFocusedPlaceId(null);
    openItem(item);
  }

  return (
    <View style={styles.root}>
      <MapView
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        style={StyleSheet.absoluteFillObject}
        initialRegion={region}
        region={region}
        onRegionChangeComplete={(r) => {
          setRegion(r);
          qc.setQueryData(["tab-state", "map-region"], r);
          setFocusedPlaceId(null);
          setTrackMarkers(true);
          void saveLastLocationForWidgets({ lat: r.latitude, lng: r.longitude });
        }}
        onPress={() => setFocusedPlaceId(null)}
        showsUserLocation
        showsMyLocationButton
        showsPointsOfInterest={false}
        showsBuildings={false}
      >
        {items.map((item) => {
          const pin = resolvePinTicker(item, brandTickers);
          const quote = pin ? quotes[pin.symbol] : undefined;
          const hasTicker = !!pin;
          const revealed = focusedPlaceId === item.place.id;
          const showChip = shouldShowChip(item, items, region, focusedPlaceId, brandTickers);
          return (
            <Marker
              key={item.place.id}
              coordinate={{
                latitude: item.place.location.lat,
                longitude: item.place.location.lng,
              }}
              tracksViewChanges={trackMarkers || revealed}
              anchor={{ x: 0.5, y: 1 }}
              zIndex={revealed ? 100 : showChip ? 3 : hasTicker ? 2 : 1}
              onPress={(e) => {
                e.stopPropagation?.();
                onPinPress(item);
              }}
            >
              <TickerPin
                placeName={item.place.name}
                pin={showChip ? pin : null}
                quote={quote}
                accent={pinColor(item)}
                revealed={revealed}
              />
            </Marker>
          );
        })}
      </MapView>

      <View pointerEvents="none" style={styles.overlay}>
        {nearbyQuery.isFetching || quotesQuery.isFetching ? (
          <BlurView intensity={40} tint="dark" style={styles.loadingPill}>
            <ActivityIndicator color={colors.fg} size="small" />
          </BlurView>
        ) : null}
        {permErr ? (
          <BlurView intensity={40} tint="dark" style={styles.warnWrap}>
            <Text style={styles.warn}>{permErr}</Text>
          </BlurView>
        ) : null}
        {nearbyQuery.isError ? (
          <BlurView intensity={40} tint="dark" style={styles.warnWrap}>
            <Text style={styles.warn}>
              {(nearbyQuery.error as Error).message || "Could not load nearby brands."}
            </Text>
          </BlurView>
        ) : null}
        {focusedPlaceId ? (
          <BlurView intensity={40} tint="dark" style={styles.warnWrap}>
            <Text style={styles.warn}>Tap again to open</Text>
          </BlurView>
        ) : null}
      </View>

      <NearbySheet
        items={items}
        brandTickers={brandTickers}
        quotes={quotes}
        loading={nearbyQuery.isFetching && items.length === 0}
        focusedPlaceId={focusedPlaceId}
        onOpen={openItem}
        onViewAsList={() => router.push("/(tabs)/list")}
        onChat={() =>
          openChatAbout(router, {
            kind: "map",
            label: `${items.length} pins on screen`,
            center: { lat: region.latitude, lng: region.longitude },
            nearby: items.slice(0, 20).map((i) => {
              const pin = resolvePinTicker(i, brandTickers);
              return {
                ticker: pin?.symbol,
                name: i.place.name,
              };
            }),
          })
        }
      />
    </View>
  );
}

function NearbySheet({
  items,
  brandTickers,
  quotes,
  loading,
  focusedPlaceId,
  onOpen,
  onViewAsList,
  onChat,
}: {
  items: NearbyItem[];
  brandTickers: Map<string, PinTicker>;
  quotes: Record<string, Quote>;
  loading: boolean;
  focusedPlaceId: string | null;
  onOpen: (item: NearbyItem) => void;
  onViewAsList: () => void;
  onChat: () => void;
}) {
  const [open, setOpen] = useState(true);
  const rows = items.slice(0, 6);

  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHead}>
        <Pressable
          onPress={() => {
            hapticSelect();
            setOpen((v) => !v);
          }}
          style={styles.sheetToggle}
          accessibilityRole="button"
          accessibilityLabel={open ? "Collapse nearby list" : "Expand nearby list"}
        >
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>
            {loading ? "Finding nearby…" : items.length ? `Nearby · ${items.length}` : "Nearby"}
          </Text>
          <Ionicons name={open ? "chevron-down" : "chevron-up"} size={16} color={colors.fgMuted} />
        </Pressable>
        {items.length > 0 ? (
          <View style={styles.sheetActions}>
            <ChatAboutButton
              accessibilityLabel="Chat about brands visible on the map"
              onPress={onChat}
            />
            <Pressable
              onPress={() => {
                hapticSelect();
                onViewAsList();
              }}
              hitSlop={8}
              style={styles.viewAsListBtn}
              accessibilityRole="button"
              accessibilityLabel="View as list"
            >
              <Ionicons name="list-outline" size={14} color={colors.accent} />
              <Text style={styles.sheetSeeAll}>View as List</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {open ? (
        rows.length === 0 ? (
          <Text style={styles.sheetEmpty}>
            {loading
              ? "Looking for brands around you."
              : "Walk around — every pin is a company you can look inside."}
          </Text>
        ) : (
          rows.map((item) => {
            const pin = resolvePinTicker(item, brandTickers);
            const quote = pin ? quotes[pin.symbol] : undefined;
            const up = (quote?.change ?? 0) >= 0;
            const focused = focusedPlaceId === item.place.id;
            return (
              <Pressable
                key={item.place.id}
                onPress={() => onOpen(item)}
                style={[styles.sheetRow, focused && styles.sheetRowFocused]}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.place.name}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetPlace} numberOfLines={1}>
                    {item.place.name}
                  </Text>
                  <Text style={styles.sheetTicker} numberOfLines={1}>
                    {pin ? `${pin.isPublic ? "$" : "≈"}${pin.symbol}` : "Tap to look up"}
                  </Text>
                </View>
                {quote ? (
                  <Text style={[styles.sheetQuote, { color: up ? colors.accent : colors.danger }]}>
                    {up ? "+" : ""}
                    {quote.changePct.toFixed(1)}%
                  </Text>
                ) : (
                  <Ionicons name="chevron-forward" size={14} color={colors.fgDim} />
                )}
              </Pressable>
            );
          })
        )
      ) : null}
    </View>
  );
}

type PinTicker = {
  symbol: string;
  isPublic: boolean;
};

function brandKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function brandTickerIndex(items: NearbyItem[]): Map<string, PinTicker> {
  const out = new Map<string, PinTicker>();
  for (const item of items) {
    const pin = resolveOwnTicker(item);
    if (pin) out.set(brandKey(item.place.name), pin);
  }
  return out;
}

function resolveOwnTicker(item: NearbyItem): PinTicker | null {
  const inv = item.investable;
  if (!inv) return null;
  const own = inv.brand.ticker?.symbol?.trim().toUpperCase();
  if (own) return { symbol: own, isPublic: !!inv.brand.isPublic };
  const comp = inv.comparables?.[0]?.ticker?.trim().toUpperCase();
  if (comp) return { symbol: comp, isPublic: false };
  return null;
}

function resolvePinTicker(
  item: NearbyItem,
  brandTickers?: Map<string, PinTicker>,
): PinTicker | null {
  return resolveOwnTicker(item) ?? brandTickers?.get(brandKey(item.place.name)) ?? null;
}

function viewportRadiusM(region: Region): number {
  const half = (region.latitudeDelta * 111_320) / 2;
  return Math.round(Math.max(250, Math.min(2500, half)));
}

function zoomBucket(region: Region): string {
  const d = region.latitudeDelta;
  if (d < 0.004) return "street";
  if (d < 0.012) return "block";
  if (d < 0.03) return "hood";
  return "wide";
}

/** Full chip on the pin closest to the viewport center in an overlap cluster. */
function shouldShowChip(
  item: NearbyItem,
  items: NearbyItem[],
  region: Region,
  focusedPlaceId: string | null,
  brandTickers: Map<string, PinTicker>,
): boolean {
  if (focusedPlaceId === item.place.id) return true;
  if (!resolvePinTicker(item, brandTickers)) return false;
  const cluster = items.filter(
    (other) => haversineMeters(item.place.location, other.place.location) <= OVERLAP_METERS,
  );
  if (cluster.length <= 1) return true;
  const center = { lat: region.latitude, lng: region.longitude };
  let best = cluster[0];
  let bestD = haversineMeters(best.place.location, center);
  for (const other of cluster.slice(1)) {
    const d = haversineMeters(other.place.location, center);
    if (d < bestD) {
      best = other;
      bestD = d;
    }
  }
  return best.place.id === item.place.id;
}

function TickerPin({
  placeName,
  pin,
  quote,
  accent,
  revealed,
}: {
  placeName: string;
  pin: PinTicker | null;
  quote?: Quote;
  accent: string;
  revealed?: boolean;
}) {
  if (!pin) {
    return (
      <View style={styles.plainCanvas} collapsable={false}>
        <View style={[styles.plainDot, { backgroundColor: accentHex(accent) }]} />
      </View>
    );
  }

  const up = (quote?.change ?? 0) >= 0;
  const w = revealed ? PIN_W_REVEALED : PIN_W;
  const h = revealed ? PIN_H_REVEALED : PIN_H;
  return (
    <View style={[styles.pinCanvas, { width: w, height: h }]} collapsable={false}>
      <View
        style={[
          styles.bubble,
          {
            width: w - 4,
            borderColor: accentHex(accent),
            borderWidth: revealed ? 2.5 : 1.5,
            backgroundColor: revealed ? "rgba(12, 14, 16, 0.98)" : "rgba(12, 14, 16, 0.94)",
          },
        ]}
      >
        <Text style={[styles.tickerText, revealed && { fontSize: 14 }]} numberOfLines={1}>
          {pin.isPublic ? "$" : "≈"}
          {pin.symbol}
        </Text>
        {quote ? (
          <Text style={[styles.priceText, revealed && { fontSize: 12 }]} numberOfLines={1}>
            ${quote.price.toFixed(2)}{" "}
            <Text style={{ color: up ? colors.accent : colors.danger }}>
              {up ? "+" : ""}
              {quote.changePct.toFixed(1)}%
            </Text>
          </Text>
        ) : (
          <Text style={styles.priceMuted}>…</Text>
        )}
        <Text
          style={[styles.placeHint, revealed && { fontSize: 11, maxWidth: w - 12 }]}
          numberOfLines={1}
        >
          {placeName}
        </Text>
      </View>
      <View style={[styles.stem, { borderTopColor: accentHex(accent) }]} />
      <View style={[styles.dot, { backgroundColor: accentHex(accent) }]} />
    </View>
  );
}

function pinColor(item: NearbyItem): string {
  const inv = item.investable;
  if (!inv) return "gray";
  if (inv.brand.isPublic || inv.brand.ticker?.symbol) {
    const sector = (inv.brand.sector ?? "").toLowerCase();
    if (sector.includes("tech") || sector.includes("communication")) return "blue";
    if (sector.includes("health")) return "rose";
    if (sector.includes("energy")) return "yellow";
    if (sector.includes("financ")) return "gold";
    if (sector.includes("staple") || sector.includes("defensive")) return "green";
    if (sector.includes("discretionary") || sector.includes("cyclical")) return "orange";
    return "green";
  }
  if (inv.comparables.length > 0 || inv.etfs.length > 0) return "orange";
  return "red";
}

function accentHex(name: string): string {
  switch (name) {
    case "blue":
      return colors.accent2;
    case "rose":
      return "#FF6B9D";
    case "gold":
      return "#D6A24C";
    case "yellow":
      return "#E8C547";
    case "orange":
      return "#F0A36B";
    case "green":
      return colors.accent;
    case "red":
      return colors.danger;
    default:
      return colors.fgDim;
  }
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  overlay: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 16,
    alignItems: "center",
    gap: 8,
  },
  sheet: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 2,
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingBottom: 6,
  },
  sheetToggle: { flex: 1, gap: 6 },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
  },
  sheetTitle: { color: colors.fg, fontSize: 14, fontWeight: "700" },
  sheetActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  viewAsListBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  sheetSeeAll: { color: colors.accent, fontSize: 13, fontWeight: "700" },
  sheetEmpty: {
    color: colors.fgMuted,
    fontSize: 13,
    lineHeight: 18,
    paddingVertical: 8,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sheetRowFocused: {
    backgroundColor: colors.bgSunken,
    marginHorizontal: -6,
    paddingHorizontal: 6,
    borderRadius: radii.sm,
  },
  sheetPlace: { color: colors.fg, fontSize: 14, fontWeight: "600" },
  sheetTicker: { color: colors.fgMuted, fontSize: 12, marginTop: 1 },
  sheetQuote: { fontSize: 13, fontWeight: "700" },
  loadingPill: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  warnWrap: {
    overflow: "hidden",
    borderRadius: radii.md,
  },
  warn: {
    color: colors.fg,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
  },
  pinCanvas: {
    width: PIN_W,
    height: PIN_H,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  bubble: {
    width: PIN_W - 4,
    backgroundColor: "rgba(12, 14, 16, 0.94)",
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingHorizontal: 6,
    paddingVertical: 4,
    alignItems: "center",
  },
  tickerText: {
    color: colors.fg,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  priceText: {
    color: colors.fg,
    fontSize: 10,
    fontWeight: "600",
    marginTop: 1,
  },
  priceMuted: { color: colors.fgDim, fontSize: 10, marginTop: 1 },
  placeHint: {
    color: colors.fgMuted,
    fontSize: 9,
    marginTop: 1,
    maxWidth: PIN_W - 12,
    textAlign: "center",
  },
  stem: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginTop: -1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 1,
    borderWidth: 1.5,
    borderColor: colors.fg,
  },
  plainCanvas: {
    width: PLAIN_W,
    height: PLAIN_H,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  plainDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.fg,
    marginBottom: 2,
  },
});
