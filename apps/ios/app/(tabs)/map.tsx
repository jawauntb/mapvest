import { type Quote, fetchChart, fetchNearby, fetchQuotesMap } from "@/api/client";
import type { NearbyItem } from "@/api/types";
import { useSession } from "@/auth/session";
import { colors, radii } from "@/theme/tokens";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BlurView } from "expo-blur";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
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
const PLAIN_W = 28;
const PLAIN_H = 28;

export default function MapScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const cachedRegion = qc.getQueryData<Region>(["tab-state", "map-region"]);
  const [region, setRegion] = useState<Region>(cachedRegion ?? FALLBACK_REGION);
  const [permErr, setPermErr] = useState<string | null>(null);
  /** Tracks until quotes render into the bitmap, then freezes for perf. */
  const [trackMarkers, setTrackMarkers] = useState(true);

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
    })();
  }, [cachedRegion, qc]);

  const nearbyQuery = useQuery({
    queryKey: ["nearby", region.latitude.toFixed(3), region.longitude.toFixed(3)],
    queryFn: () =>
      fetchNearby(
        { lat: region.latitude, lng: region.longitude, radius: 1500, limit: 50 },
        { token: session?.token },
      ),
    staleTime: 5 * 60_000,
  });

  const items = useMemo(() => nearbyQuery.data?.items ?? [], [nearbyQuery.data]);

  const pinTickers = useMemo(() => {
    const out: string[] = [];
    for (const item of items) {
      const t = resolvePinTicker(item);
      if (t) out.push(t.symbol);
    }
    return [...new Set(out)];
  }, [items]);

  const quotesQuery = useQuery({
    queryKey: ["map-quotes", pinTickers.join(",")],
    enabled: pinTickers.length > 0,
    queryFn: () => fetchQuotesMap(pinTickers, { token: session?.token }),
    staleTime: 60_000,
  });

  const quotes = quotesQuery.data ?? {};

  useEffect(() => {
    // Re-rasterize markers when items/quotes change, then freeze.
    setTrackMarkers(true);
    const delay = quotesQuery.isFetching ? 1600 : 700;
    const t = setTimeout(() => setTrackMarkers(false), delay);
    return () => clearTimeout(t);
  }, [items, quotesQuery.isFetching, quotesQuery.dataUpdatedAt]);

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

  return (
    <View style={styles.root}>
      <MapView
        provider={Platform.OS === "ios" ? PROVIDER_GOOGLE : PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFillObject}
        initialRegion={region}
        region={region}
        onRegionChangeComplete={(r) => {
          setRegion(r);
          qc.setQueryData(["tab-state", "map-region"], r);
        }}
        showsUserLocation
        showsMyLocationButton
      >
        {items.map((item) => {
          const pin = resolvePinTicker(item);
          const quote = pin ? quotes[pin.symbol] : undefined;
          const hasTicker = !!pin;
          return (
            <Marker
              key={item.place.id}
              coordinate={{
                latitude: item.place.location.lat,
                longitude: item.place.location.lng,
              }}
              tracksViewChanges={trackMarkers}
              // Bottom-center of the fixed canvas sits on the lat/lng.
              anchor={{ x: 0.5, y: 1 }}
              zIndex={hasTicker ? 2 : 1}
              onPress={() => openItem(item)}
            >
              <TickerPin
                placeName={item.place.name}
                pin={pin}
                quote={quote}
                accent={pinColor(item)}
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
      </View>
    </View>
  );
}

type PinTicker = {
  symbol: string;
  isPublic: boolean;
};

function resolvePinTicker(item: NearbyItem): PinTicker | null {
  const inv = item.investable;
  if (!inv) return null;
  const own = inv.brand.ticker?.symbol?.trim().toUpperCase();
  if (own) return { symbol: own, isPublic: !!inv.brand.isPublic };
  const comp = inv.comparables?.[0]?.ticker?.trim().toUpperCase();
  if (comp) return { symbol: comp, isPublic: false };
  return null;
}

function TickerPin({
  placeName,
  pin,
  quote,
  accent,
}: {
  placeName: string;
  pin: PinTicker | null;
  quote?: Quote;
  accent: string;
}) {
  if (!pin) {
    return (
      <View style={styles.plainCanvas} collapsable={false}>
        <View style={[styles.plainDot, { backgroundColor: accentHex(accent) }]} />
      </View>
    );
  }

  const up = (quote?.change ?? 0) >= 0;
  return (
    // Fixed canvas so Google's marker bitmap + anchor stay aligned to lat/lng.
    <View style={styles.pinCanvas} collapsable={false}>
      <View style={[styles.bubble, { borderColor: accentHex(accent) }]}>
        <Text style={styles.tickerText} numberOfLines={1}>
          {pin.isPublic ? "$" : "≈"}
          {pin.symbol}
        </Text>
        {quote ? (
          <Text style={styles.priceText} numberOfLines={1}>
            ${quote.price.toFixed(2)}{" "}
            <Text style={{ color: up ? colors.accent : colors.danger }}>
              {up ? "+" : ""}
              {quote.changePct.toFixed(1)}%
            </Text>
          </Text>
        ) : (
          <Text style={styles.priceMuted}>…</Text>
        )}
        <Text style={styles.placeHint} numberOfLines={1}>
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

// Categorical pin palette — brand rule: no purple. Distinct from the
// signature jade/blue accent so investable pins stay visually separate.
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
