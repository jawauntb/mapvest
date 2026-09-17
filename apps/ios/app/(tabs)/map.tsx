import { type Quote, fetchNearby, fetchQuotesMap } from "@/api/client";
import {
  EVOLUTION_TIER_COLORS,
  EVOLUTION_TIER_LABELS,
  type Find,
  changeSinceFoundPct,
  evolutionTierForChange,
  listFinds,
} from "@/api/finds";
import type { NearbyItem } from "@/api/types";
import { useSession } from "@/auth/session";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { findsQueryKey } from "@/finds/queryKeys";
import { LocationContextNotice } from "@/location/LocationContextNotice";
import {
  LOCATION_CONTEXT_QUERY_KEY,
  type LocationContextState,
  type LocationRegion,
  MAP_REGION_QUERY_KEY,
  locationContextHeading,
  locationRegionFromLatLng,
  locationUnavailableContext,
  mapAreaContext,
  permissionDeniedContext,
  resolveInitialLocationContext,
  sameLocationRegion,
  shouldApplyDeviceFix,
  transitionLocationContext,
  visibleResultsForLocationContext,
} from "@/location/locationContext";
import { openChatAbout } from "@/nav/chatAbout";
import { matchNotificationMapTarget } from "@/notif/mapTarget";
import { colors, motion, radii } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { useWidgetDiscoverySync } from "@/widgets/widgetDiscoverySync";
import { readLastLocationForWidgets, saveLastLocationForWidgets } from "@/widgets/widgetLocation";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BlurView } from "expo-blur";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

/** Fixed pin canvas — variable-height custom markers mis-anchor on Google Maps. */
const PIN_W = 104;
const PIN_H = 86;
const PIN_W_REVEALED = 128;
const PIN_H_REVEALED = 102;
const PLAIN_W = 28;
const PLAIN_H = 28;

/** ~meters between pins that count as overlapping for two-tap reveal. */
const OVERLAP_METERS = 55;

function regionFromWidgetParams(
  rawLat: string | string[] | undefined,
  rawLng: string | string[] | undefined,
): LocationRegion | null {
  const lat = Number(Array.isArray(rawLat) ? rawLat[0] : rawLat);
  const lng = Number(Array.isArray(rawLng) ? rawLng[0] : rawLng);
  return locationRegionFromLatLng({ lat, lng });
}

type CameraUpdateMode = "programmatic" | "user";

export default function MapScreen() {
  const router = useRouter();
  const mapPanInProgress = useRef(false);
  const params = useLocalSearchParams<{
    lat?: string | string[];
    lng?: string | string[];
    source?: string | string[];
    deliveryId?: string | string[];
    placeId?: string | string[];
    ticker?: string | string[];
    label?: string | string[];
    reason?: string | string[];
  }>();
  const qc = useQueryClient();
  const { session } = useSession();
  useQuery<LocationContextState | undefined>({
    queryKey: LOCATION_CONTEXT_QUERY_KEY,
    queryFn: () => undefined,
    enabled: false,
    gcTime: Number.POSITIVE_INFINITY,
  });
  useQuery<Region | undefined>({
    queryKey: MAP_REGION_QUERY_KEY,
    queryFn: () => undefined,
    enabled: false,
    gcTime: Number.POSITIVE_INFINITY,
  });
  const cachedContext = qc.getQueryData<LocationContextState>(LOCATION_CONTEXT_QUERY_KEY);
  const cachedRegion = qc.getQueryData<Region>(MAP_REGION_QUERY_KEY);
  const linkedRegion = useMemo(
    () => regionFromWidgetParams(params.lat, params.lng),
    [params.lat, params.lng],
  );
  const initialContext = resolveInitialLocationContext({
    linkedRegion,
    cachedContext,
    cachedRegion,
  });
  const [locationContext, setLocationContext] = useState<LocationContextState>(initialContext);
  const contextRef = useRef(locationContext);
  const programmaticCameraRegionRef = useRef<LocationRegion | null>(initialContext.region);
  const lastHandledCameraRegionRef = useRef<LocationRegion | null>(initialContext.region);
  const locationRequestGeneration = useRef(0);
  const [isLocating, setIsLocating] = useState(initialContext.kind === "loading");
  const isFocused = useIsFocused();
  const region = locationContext.region as Region;
  /** Tracks until quotes render into the bitmap, then freezes for perf. */
  const [trackMarkers, setTrackMarkers] = useState(true);
  /** First tap on an overlapped cluster elevates this place; second opens detail. */
  const [focusedPlaceId, setFocusedPlaceId] = useState<string | null>(null);
  /** "Map of your life" — the user's camera finds as a toggleable layer. */
  const [showFinds, setShowFinds] = useState(true);
  /** Silhouette layer — nearby investables the user has not caught yet. */
  const [showUncaught, setShowUncaught] = useState(true);
  const [notificationNotice, setNotificationNotice] = useState<{
    kind: "matched" | "missing";
    message: string;
  } | null>(null);
  const handledNotificationTargetRef = useRef<string | null>(null);

  const publishLocationContext = useCallback(
    (next: LocationContextState, cameraUpdate?: CameraUpdateMode) => {
      if (cameraUpdate === "programmatic") {
        if (!sameLocationRegion(contextRef.current.region, next.region)) {
          programmaticCameraRegionRef.current = next.region;
        }
        lastHandledCameraRegionRef.current = next.region;
      } else if (cameraUpdate === "user") {
        programmaticCameraRegionRef.current = null;
        lastHandledCameraRegionRef.current = next.region;
      }
      contextRef.current = next;
      setLocationContext(next);
      qc.setQueryData(LOCATION_CONTEXT_QUERY_KEY, next);
      qc.setQueryData(MAP_REGION_QUERY_KEY, next.region);
    },
    [qc],
  );

  const requestDeviceLocation = useCallback(async () => {
    const requestGeneration = ++locationRequestGeneration.current;
    const requestStartedAt = Date.now();
    const shouldContinue = () =>
      requestGeneration === locationRequestGeneration.current &&
      shouldApplyDeviceFix(
        qc.getQueryData<LocationContextState>(LOCATION_CONTEXT_QUERY_KEY),
        requestStartedAt,
      );
    setIsLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (!shouldContinue()) return;
      if (status !== "granted") {
        publishLocationContext(
          status === "denied"
            ? permissionDeniedContext(contextRef.current)
            : locationUnavailableContext(contextRef.current),
        );
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (!shouldContinue()) return;
      const nextRegion = locationRegionFromLatLng({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      });
      if (!nextRegion) {
        publishLocationContext(locationUnavailableContext(contextRef.current));
        return;
      }
      const next = transitionLocationContext(contextRef.current, {
        type: "device-fix",
        region: nextRegion,
        capturedAt: loc.timestamp,
      });
      publishLocationContext(next, "programmatic");
      void saveLastLocationForWidgets(
        { lat: nextRegion.latitude, lng: nextRegion.longitude },
        { capturedAt: loc.timestamp, source: "device" },
      );
    } catch {
      if (shouldContinue()) {
        publishLocationContext(locationUnavailableContext(contextRef.current));
      }
    } finally {
      if (requestGeneration === locationRequestGeneration.current) setIsLocating(false);
    }
  }, [publishLocationContext, qc]);

  const handleLocationAction = useCallback(() => {
    if (locationContext.kind === "permission-denied") {
      void Linking.openSettings();
      return;
    }
    void requestDeviceLocation();
  }, [locationContext.kind, requestDeviceLocation]);

  const markUserCameraInteraction = useCallback(() => {
    if (!mapPanInProgress.current) {
      locationRequestGeneration.current += 1;
      setIsLocating(false);
    }
    mapPanInProgress.current = true;
    programmaticCameraRegionRef.current = null;
  }, []);

  useEffect(() => {
    if (!linkedRegion) return;
    locationRequestGeneration.current += 1;
    setIsLocating(false);
    publishLocationContext(mapAreaContext(linkedRegion), "programmatic");
  }, [linkedRegion, publishLocationContext]);

  useEffect(() => {
    if (linkedRegion || !isFocused) return;
    let cancelled = false;
    (async () => {
      let restored = resolveInitialLocationContext({ cachedContext, cachedRegion });
      const persisted =
        restored.kind === "loading" ? await readLastLocationForWidgets() : undefined;
      if (cancelled) return;
      if (persisted) {
        restored = resolveInitialLocationContext({
          cachedContext,
          cachedRegion,
          persistedLocation: persisted,
        });
      }
      if (restored.kind === "device-origin") {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== "granted") {
          publishLocationContext(
            status === "denied"
              ? permissionDeniedContext(restored)
              : locationUnavailableContext(restored),
          );
          setIsLocating(false);
          return;
        }
      }
      if (restored.kind !== "loading") {
        publishLocationContext(restored, "programmatic");
        setIsLocating(false);
        return;
      }
      if (!cancelled) await requestDeviceLocation();
    })();
    return () => {
      cancelled = true;
    };
  }, [
    cachedContext,
    cachedRegion,
    isFocused,
    linkedRegion,
    publishLocationContext,
    requestDeviceLocation,
  ]);

  useEffect(() => {
    if (isFocused) return;
    locationRequestGeneration.current += 1;
    setIsLocating(false);
  }, [isFocused]);

  useEffect(() => {
    if (!isFocused || linkedRegion) return;
    const next = resolveInitialLocationContext({
      cachedContext: qc.getQueryData<LocationContextState>(LOCATION_CONTEXT_QUERY_KEY),
      cachedRegion: qc.getQueryData<Region>(MAP_REGION_QUERY_KEY),
    });
    if (next.kind === "loading" || next === contextRef.current) return;
    publishLocationContext(next, "programmatic");
  }, [isFocused, linkedRegion, publishLocationContext, qc]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (isFocused && nextState === "active" && contextRef.current.kind === "permission-denied") {
        void requestDeviceLocation();
      }
    });
    return () => subscription.remove();
  }, [isFocused, requestDeviceLocation]);

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
    enabled: locationContext.kind !== "loading",
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

  useEffect(() => {
    const source = Array.isArray(params.source) ? params.source[0] : params.source;
    if (source !== "notification" || nearbyQuery.isFetching) return;
    const deliveryId = Array.isArray(params.deliveryId) ? params.deliveryId[0] : params.deliveryId;
    const placeId = Array.isArray(params.placeId) ? params.placeId[0] : params.placeId;
    const ticker = Array.isArray(params.ticker) ? params.ticker[0] : params.ticker;
    const label = Array.isArray(params.label) ? params.label[0] : params.label;
    const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason;
    const targetKey = deliveryId ?? `${placeId ?? ""}:${ticker ?? ""}`;
    if (!targetKey || handledNotificationTargetRef.current === targetKey) return;

    handledNotificationTargetRef.current = targetKey;
    if (nearbyQuery.isError) {
      setNotificationNotice({
        kind: "missing",
        message: `Centered near ${label ?? ticker ?? "the company"}, but nearby results could not refresh.`,
      });
      return;
    }
    const match = matchNotificationMapTarget(items, { placeId, ticker });
    if (match) {
      setShowUncaught(true);
      setFocusedPlaceId(match.item.place.id);
      setNotificationNotice({
        kind: "matched",
        message: reason ?? `Showing ${label ?? match.item.place.name} from your notification.`,
      });
      return;
    }
    setNotificationNotice({
      kind: "missing",
      message: `Centered near ${label ?? ticker ?? "the company"}, but it is not in the latest nearby results.`,
    });
  }, [
    items,
    nearbyQuery.isError,
    nearbyQuery.isFetching,
    params.deliveryId,
    params.label,
    params.placeId,
    params.reason,
    params.source,
    params.ticker,
  ]);
  const visibleItems = useMemo(
    () => visibleResultsForLocationContext(locationContext, items),
    [items, locationContext],
  );
  const brandTickers = useMemo(() => brandTickerIndex(visibleItems), [visibleItems]);

  const pinTickers = useMemo(() => {
    const out: string[] = [];
    for (const item of visibleItems) {
      const t = resolvePinTicker(item, brandTickers);
      if (t) out.push(t.symbol);
    }
    return [...new Set(out)];
  }, [visibleItems, brandTickers]);

  const quotesQuery = useQuery({
    queryKey: ["map-quotes", pinTickers.join(",")],
    enabled: pinTickers.length > 0,
    queryFn: () => fetchQuotesMap(pinTickers, { token: session?.token }),
    staleTime: 60_000,
  });

  const quotes = quotesQuery.data ?? {};

  // Keep the map's 100-row projection distinct from Universe's 200-row cache.
  const findsQuery = useQuery({
    queryKey: findsQueryKey(session?.token),
    queryFn: () => listFinds({ token: session?.token }),
    enabled: !!session?.token,
    staleTime: 60_000,
  });

  const widgetOrigin = useMemo(
    () => ({ lat: region.latitude, lng: region.longitude }),
    [region.latitude, region.longitude],
  );
  useWidgetDiscoverySync({
    context: locationContext,
    origin: widgetOrigin,
    items: visibleItems,
    settled:
      !nearbyQuery.isFetching &&
      !nearbyQuery.isError &&
      nearbyQuery.data !== undefined &&
      (!session?.token || (!findsQuery.isError && findsQuery.data !== undefined)),
    enabled: isFocused,
    finds: findsQuery.data?.finds,
  });

  const geoFinds = useMemo(() => {
    const seen = new Set<string>();
    const out: { find: Find; lat: number; lng: number }[] = [];
    for (const find of findsQuery.data?.finds ?? []) {
      const { lat, lng } = find;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      // Repeat snaps of the same spot collapse into one marker.
      const key = `${lat.toFixed(5)},${lng.toFixed(5)},${find.ticker ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ find, lat, lng });
      if (out.length >= 100) break;
    }
    return out;
  }, [findsQuery.data]);

  /**
   * Quotes for the *finds* layer (roadmap A2 tier rings). The nearby quote map
   * only covers what is currently on screen as a pin, and a find badge needs
   * its own symbol priced to know whether it has evolved. Shares the
   * ["find-quotes", …] cache with Home and the journal; fails soft — no quote
   * simply means no ring.
   */
  const findQuoteSyms = useMemo(() => {
    const out = new Set<string>();
    for (const { find } of geoFinds) {
      if (!find.foundPrice) continue; // no basis → no delta → no tier
      const sym = (find.ticker ?? find.comparable)?.trim().toUpperCase();
      if (sym) out.add(sym);
    }
    return [...out].slice(0, 24);
  }, [geoFinds]);

  const findQuotesQuery = useQuery({
    queryKey: ["find-quotes", findQuoteSyms.join(",")],
    enabled: findQuoteSyms.length > 0,
    queryFn: () => fetchQuotesMap(findQuoteSyms, { token: session?.token }),
    staleTime: 60_000,
    retry: false,
  });
  const findQuotes: Record<string, Quote> = findQuotesQuery.data ?? {};

  /** Evolution tier for a find, or null when it has no basis or no quote yet. */
  const tierForFind = useCallback(
    (find: Find) => {
      const sym = (find.ticker ?? find.comparable)?.trim().toUpperCase();
      const price = sym ? findQuotes[sym]?.price : undefined;
      return evolutionTierForChange(changeSinceFoundPct(find, price));
    },
    [findQuotes],
  );

  /**
   * Everything the user has already caught, keyed by the same effective ticker
   * a pin resolves to: the public symbol when listed, otherwise the
   * private→public comparable. Ungeocoded finds still count — a catch is a
   * catch regardless of whether the snap carried coordinates.
   */
  const caughtTickers = useMemo(() => {
    const out = new Set<string>();
    for (const find of findsQuery.data?.finds ?? []) {
      const t = (find.ticker ?? find.comparable)?.trim().toUpperCase();
      if (t) out.add(t);
    }
    return out;
  }, [findsQuery.data]);

  /** Investable (has a resolvable ticker) and absent from the finds journal. */
  const isUncaught = useCallback(
    (item: NearbyItem) => {
      const pin = resolvePinTicker(item, brandTickers);
      return !!pin && !caughtTickers.has(pin.symbol);
    },
    [brandTickers, caughtTickers],
  );

  /**
   * Rendered pins. Filtering here (rather than at draw time) keeps the overlap
   * cluster + chip math consistent with what is actually on screen, and can
   * only shrink the marker count below the existing nearby cap.
   */
  const mapItems = useMemo(
    () => (showUncaught ? visibleItems : visibleItems.filter((item) => !isUncaught(item))),
    [visibleItems, showUncaught, isUncaught],
  );
  const uncaughtCount = useMemo(
    () => visibleItems.reduce((n, item) => n + (isUncaught(item) ? 1 : 0), 0),
    [visibleItems, isUncaught],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: these values intentionally reopen the native marker rasterization window when pin content changes
  useEffect(() => {
    setTrackMarkers(true);
    // Long enough for the staggered pin-drop springs (~315ms max delay +
    // ~500ms spring) to finish before markers rasterize.
    const delay = quotesQuery.isFetching ? 1600 : 1100;
    const t = setTimeout(() => setTrackMarkers(false), delay);
    return () => clearTimeout(t);
    // caughtTickers/showUncaught change the pin bitmaps (silhouette ⇄ jade), so
    // they have to reopen the tracking window or the change never rasterizes.
    // Same for late find quotes: they only change the badge's ring ink, but ink
    // still has to be redrawn into the marker bitmap once.
  }, [
    visibleItems,
    quotesQuery.isFetching,
    quotesQuery.dataUpdatedAt,
    findQuotesQuery.dataUpdatedAt,
    focusedPlaceId,
    caughtTickers,
    showUncaught,
  ]);

  function openItem(item: NearbyItem) {
    const pin = resolvePinTicker(item);
    const id = pin?.symbol ?? item.place.name;
    router.push(`/detail/${encodeURIComponent(id)}`);
  }

  function openFind(find: Find) {
    hapticSelect();
    const id = find.ticker ?? find.comparable ?? find.brand;
    router.push(`/detail/${encodeURIComponent(id)}`);
  }

  /**
   * Overlapped pins: first tap elevates/reveals the whole tooltip; second tap
   * (same focused pin) opens the summary. Solo pins open immediately.
   */
  function onPinPress(item: NearbyItem) {
    hapticSelect();
    const cluster = mapItems.filter(
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
        onPanDrag={markUserCameraInteraction}
        onRegionChange={(r, details) => {
          const programmaticRegion = programmaticCameraRegionRef.current;
          if (
            details?.isGesture === true ||
            (!programmaticRegion && !sameLocationRegion(r, region))
          ) {
            markUserCameraInteraction();
          }
        }}
        onRegionChangeComplete={(r, details) => {
          setTrackMarkers(true);
          const userCameraInteraction = details?.isGesture === true || mapPanInProgress.current;
          if (userCameraInteraction) {
            setFocusedPlaceId(null);
            setNotificationNotice(null);
          }
          const programmaticRegion = programmaticCameraRegionRef.current;
          const isProgrammaticCompletion =
            !userCameraInteraction && sameLocationRegion(r, programmaticRegion);
          const isDuplicateCompletion =
            !userCameraInteraction &&
            !isProgrammaticCompletion &&
            sameLocationRegion(r, lastHandledCameraRegionRef.current);
          mapPanInProgress.current = false;
          if (isProgrammaticCompletion || isDuplicateCompletion) {
            programmaticCameraRegionRef.current = null;
            lastHandledCameraRegionRef.current = r;
            return;
          }
          programmaticCameraRegionRef.current = null;
          if (!userCameraInteraction) {
            locationRequestGeneration.current += 1;
            setIsLocating(false);
          }
          const capturedAt = Date.now();
          publishLocationContext(
            transitionLocationContext(contextRef.current, {
              type: "map-pan",
              region: r,
              capturedAt,
            }),
            "user",
          );
          void saveLastLocationForWidgets(
            { lat: r.latitude, lng: r.longitude },
            { capturedAt, source: "map" },
          );
        }}
        onPress={() => {
          setFocusedPlaceId(null);
          setNotificationNotice(null);
        }}
        showsUserLocation
        showsMyLocationButton
        showsPointsOfInterest={false}
        showsBuildings={false}
      >
        {mapItems.map((item, idx) => {
          const pin = resolvePinTicker(item, brandTickers);
          const quote = pin ? quotes[pin.symbol] : undefined;
          const hasTicker = !!pin;
          const revealed = focusedPlaceId === item.place.id;
          const showChip = shouldShowChip(item, mapItems, region, focusedPlaceId, brandTickers);
          // Silhouette: investable, but missing from the finds journal.
          const uncaught = pin ? !caughtTickers.has(pin.symbol) : false;
          return (
            <Marker
              key={item.place.id}
              coordinate={{
                latitude: item.place.location.lat,
                longitude: item.place.location.lng,
              }}
              tracksViewChanges={trackMarkers || revealed}
              anchor={{ x: 0.5, y: 1 }}
              zIndex={revealed ? 100 : uncaught ? 1 : showChip ? 3 : hasTicker ? 2 : 1}
              accessibilityLabel={
                pin
                  ? `${item.place.name} — ${pin.isPublic ? "" : "comparable "}${pin.symbol}${
                      uncaught ? " — not caught yet" : ""
                    }`
                  : item.place.name
              }
              onPress={(e) => {
                e.stopPropagation?.();
                onPinPress(item);
              }}
            >
              <TickerPin
                placeName={item.place.name}
                pin={showChip ? pin : null}
                quote={quote}
                accent={uncaught ? "gray" : pinColor(item)}
                revealed={revealed}
                uncaught={uncaught}
                dropDelay={(idx % 10) * 35}
              />
            </Marker>
          );
        })}
        {showFinds
          ? geoFinds.map(({ find, lat, lng }) => {
              // Evolution tier (roadmap A2). The badge keeps its exact 18pt
              // canvas — only the border ink changes, the same trick the
              // silhouette layer uses — so the Google-provider anchor stays put.
              const tier = tierForFind(find);
              return (
                <Marker
                  key={`find-${find.id}`}
                  coordinate={{ latitude: lat, longitude: lng }}
                  tracksViewChanges={trackMarkers}
                  anchor={{ x: 0.5, y: 0.5 }}
                  zIndex={tier ? 2 : 1}
                  accessibilityLabel={`Your find: ${find.brand}${find.ticker ? ` — ${find.ticker}` : ""}${
                    tier ? ` — ${EVOLUTION_TIER_LABELS[tier]} evolution` : ""
                  }`}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    openFind(find);
                  }}
                >
                  {/* Static (no entrance anim) so late-arriving finds rasterize
                      correctly after the trackMarkers window has closed. */}
                  <View
                    style={[
                      styles.findBadge,
                      tier ? { borderColor: EVOLUTION_TIER_COLORS[tier] } : null,
                    ]}
                    collapsable={false}
                  >
                    <Ionicons name="camera" size={10} color={colors.accent} />
                  </View>
                </Marker>
              );
            })
          : null}
      </MapView>

      <View pointerEvents="box-none" style={styles.overlay}>
        <LocationContextNotice
          state={locationContext}
          busy={isLocating}
          onAction={handleLocationAction}
        />
        {nearbyQuery.isFetching || quotesQuery.isFetching ? (
          <BlurView intensity={40} tint="dark" style={styles.loadingPill}>
            <ActivityIndicator color={colors.fg} size="small" />
          </BlurView>
        ) : null}
        {nearbyQuery.isError ? (
          <BlurView intensity={40} tint="dark" style={styles.warnWrap}>
            <Text style={styles.warn}>
              {(nearbyQuery.error as Error).message || "Could not load nearby brands."}
            </Text>
          </BlurView>
        ) : null}
        {notificationNotice ? (
          <BlurView intensity={48} tint="dark" style={styles.notificationTargetWrap}>
            <View style={styles.notificationTargetCopy}>
              <Ionicons
                name={notificationNotice.kind === "matched" ? "locate" : "alert-circle-outline"}
                size={15}
                color={notificationNotice.kind === "matched" ? colors.accent : colors.warn}
              />
              <Text style={styles.notificationTargetText}>{notificationNotice.message}</Text>
            </View>
            {notificationNotice.kind === "missing" ? (
              <Pressable
                style={styles.notificationRetry}
                onPress={() => {
                  handledNotificationTargetRef.current = null;
                  setNotificationNotice(null);
                  void nearbyQuery.refetch();
                }}
                accessibilityRole="button"
                accessibilityLabel="Retry nearby company"
              >
                <Text style={styles.notificationRetryText}>Retry</Text>
              </Pressable>
            ) : null}
          </BlurView>
        ) : null}
        {focusedPlaceId ? (
          <BlurView intensity={40} tint="dark" style={styles.warnWrap}>
            <Text style={styles.warn}>Tap again to open</Text>
          </BlurView>
        ) : null}
      </View>

      <NearbySheet
        items={visibleItems}
        brandTickers={brandTickers}
        quotes={quotes}
        caughtTickers={caughtTickers}
        locationLoading={locationContext.kind === "loading" || isLocating}
        nearbyLoading={nearbyQuery.isFetching && visibleItems.length === 0}
        nearbyError={
          nearbyQuery.isError
            ? (nearbyQuery.error as Error).message || "Try again to load nearby brands."
            : null
        }
        locationContext={locationContext}
        focusedPlaceId={focusedPlaceId}
        showFindsToggle={geoFinds.length > 0}
        findsVisible={showFinds}
        onToggleFinds={() => setShowFinds((v) => !v)}
        showUncaughtToggle={uncaughtCount > 0}
        uncaughtVisible={showUncaught}
        onToggleUncaught={() => setShowUncaught((v) => !v)}
        onOpen={openItem}
        onViewAsList={() => router.push("/(tabs)/list")}
        onChat={() =>
          openChatAbout(router, {
            kind: "map",
            label: `${mapItems.length} pins on screen`,
            center: { lat: region.latitude, lng: region.longitude },
            nearby: mapItems.slice(0, 20).map((i) => {
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
  caughtTickers,
  locationLoading,
  nearbyLoading,
  nearbyError,
  locationContext,
  focusedPlaceId,
  showFindsToggle,
  findsVisible,
  onToggleFinds,
  showUncaughtToggle,
  uncaughtVisible,
  onToggleUncaught,
  onOpen,
  onViewAsList,
  onChat,
}: {
  items: NearbyItem[];
  brandTickers: Map<string, PinTicker>;
  quotes: Record<string, Quote>;
  caughtTickers: Set<string>;
  locationLoading: boolean;
  nearbyLoading: boolean;
  nearbyError: string | null;
  locationContext: LocationContextState;
  focusedPlaceId: string | null;
  /** Finds-layer chip — hidden when the user has no geo-tagged finds. */
  showFindsToggle: boolean;
  findsVisible: boolean;
  onToggleFinds: () => void;
  /** Silhouette-layer chip — hidden when everything nearby is already caught. */
  showUncaughtToggle: boolean;
  uncaughtVisible: boolean;
  onToggleUncaught: () => void;
  onOpen: (item: NearbyItem) => void;
  onViewAsList: () => void;
  onChat: () => void;
}) {
  const [open, setOpen] = useState(true);
  const rows = items.slice(0, 6);

  return (
    <View style={styles.sheet}>
      <Pressable
        onPress={() => {
          hapticSelect();
          setOpen((v) => !v);
        }}
        hitSlop={8}
        accessible={false}
      >
        <View style={styles.sheetHandle} />
      </Pressable>
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
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {locationLoading
              ? locationContextHeading(locationContext, items.length, true)
              : nearbyLoading
                ? "Loading brands…"
                : locationContextHeading(locationContext, items.length)}
          </Text>
          <Ionicons name={open ? "chevron-down" : "chevron-up"} size={16} color={colors.fgMuted} />
        </Pressable>
        {items.length > 0 ? (
          <View style={styles.sheetActions}>
            <ChatAboutButton
              accessibilityLabel="Chat about brands visible on the map"
              onPress={onChat}
            />
            {showFindsToggle ? (
              <Pressable
                onPress={() => {
                  hapticSelect();
                  onToggleFinds();
                }}
                hitSlop={8}
                style={styles.viewAsListBtn}
                accessibilityRole="button"
                accessibilityState={{ selected: findsVisible }}
                accessibilityLabel={findsVisible ? "Hide your finds" : "Show your finds"}
              >
                <Ionicons
                  name="camera-outline"
                  size={14}
                  color={findsVisible ? colors.accent : colors.fgMuted}
                />
                <Text
                  style={[styles.sheetSeeAll, !findsVisible && { color: colors.fgMuted }]}
                  numberOfLines={1}
                >
                  Finds
                </Text>
              </Pressable>
            ) : null}
            {showUncaughtToggle ? (
              <Pressable
                onPress={() => {
                  hapticSelect();
                  onToggleUncaught();
                }}
                hitSlop={8}
                style={styles.viewAsListBtn}
                accessibilityRole="button"
                accessibilityState={{ selected: uncaughtVisible }}
                accessibilityLabel={
                  uncaughtVisible ? "Hide uncaught brands" : "Show uncaught brands"
                }
              >
                <Ionicons
                  name="location-outline"
                  size={14}
                  color={uncaughtVisible ? colors.accent : colors.fgMuted}
                />
                <Text
                  style={[styles.sheetSeeAll, !uncaughtVisible && { color: colors.fgMuted }]}
                  numberOfLines={1}
                >
                  Uncaught
                </Text>
              </Pressable>
            ) : null}
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
              <Text style={styles.sheetSeeAll} numberOfLines={1}>
                View as List
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {open && nearbyError && rows.length > 0 ? (
        <Text style={styles.sheetError}>Nearby brands could not refresh. {nearbyError}</Text>
      ) : null}

      {open ? (
        rows.length === 0 ? (
          <Text style={styles.sheetEmpty}>
            {locationLoading
              ? "Checking your location before showing brands."
              : nearbyLoading
                ? "Loading brands for this area."
                : nearbyError
                  ? `Nearby brands could not load. ${nearbyError}`
                  : locationContext.kind === "fallback" ||
                      ((locationContext.kind === "permission-denied" ||
                        locationContext.kind === "unavailable") &&
                        locationContext.previous === "demo")
                    ? "Explore this demo area, or use your location to see what is around you."
                    : locationContext.kind === "map-area"
                      ? "No investable brands in this map area yet."
                      : "Walk around — every pin is a company you can look inside."}
          </Text>
        ) : (
          rows.map((item) => {
            const pin = resolvePinTicker(item, brandTickers);
            const quote = pin ? quotes[pin.symbol] : undefined;
            const up = (quote?.change ?? 0) >= 0;
            const focused = focusedPlaceId === item.place.id;
            const uncaught = pin ? !caughtTickers.has(pin.symbol) : false;
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
                  <Text
                    style={[styles.sheetTicker, uncaught && styles.sheetTickerUncaught]}
                    numberOfLines={1}
                  >
                    {pin ? `${pin.isPublic ? "$" : "≈"}${pin.symbol}` : "Tap to look up"}
                    {uncaught ? " · uncaught" : ""}
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
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
  if (!best) return true;
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
  uncaught,
  dropDelay = 0,
}: {
  placeName: string;
  pin: PinTicker | null;
  quote?: Quote;
  accent: string;
  revealed?: boolean;
  /**
   * Silhouette variant — same fixed canvas, desaturated ink. Opacity lives on
   * the (non-animated) canvas, never on the entering Animated.View, whose
   * animated opacity would override a static one.
   */
  uncaught?: boolean;
  /** Staggered entrance so pins land like a wave, not a wall. */
  dropDelay?: number;
}) {
  if (!pin) {
    return (
      <View style={[styles.plainCanvas, uncaught && styles.silhouette]} collapsable={false}>
        <Animated.View entering={FadeIn.duration(220).delay(dropDelay)}>
          <View
            style={[
              styles.plainDot,
              { backgroundColor: accentHex(accent) },
              uncaught && styles.plainDotUncaught,
            ]}
          />
        </Animated.View>
      </View>
    );
  }

  const up = (quote?.change ?? 0) >= 0;
  const w = revealed ? PIN_W_REVEALED : PIN_W;
  const h = revealed ? PIN_H_REVEALED : PIN_H;
  return (
    <View
      style={[styles.pinCanvas, { width: w, height: h }, uncaught && styles.silhouette]}
      collapsable={false}
    >
      <Animated.View
        entering={FadeInDown.springify()
          .damping(motion.springSnappy.damping)
          .stiffness(motion.springSnappy.stiffness)
          .delay(dropDelay)}
        style={{ alignItems: "center" }}
      >
        <View
          style={[
            styles.bubble,
            {
              width: w - 4,
              borderColor: accentHex(accent),
              borderWidth: revealed ? 2.5 : 1.5,
              backgroundColor: revealed ? "rgba(12, 14, 16, 0.98)" : "rgba(12, 14, 16, 0.94)",
            },
            uncaught && styles.bubbleUncaught,
          ]}
        >
          <Text
            style={[
              styles.tickerText,
              revealed && { fontSize: 14 },
              uncaught && styles.tickerTextUncaught,
            ]}
            numberOfLines={1}
            allowFontScaling={false}
          >
            {pin.isPublic ? "$" : "≈"}
            {pin.symbol}
          </Text>
          {quote ? (
            <Text
              style={[
                styles.priceText,
                revealed && { fontSize: 12 },
                uncaught && styles.priceTextUncaught,
              ]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              ${quote.price.toFixed(2)}{" "}
              <Text
                style={{
                  color: uncaught ? colors.fgDim : up ? colors.accent : colors.danger,
                }}
              >
                {up ? "+" : ""}
                {quote.changePct.toFixed(1)}%
              </Text>
            </Text>
          ) : (
            <Text style={styles.priceMuted} allowFontScaling={false}>
              …
            </Text>
          )}
          <Text
            style={[
              styles.placeHint,
              revealed && { fontSize: 11, maxWidth: w - 12 },
              uncaught && styles.placeHintUncaught,
            ]}
            numberOfLines={1}
            allowFontScaling={false}
          >
            {placeName}
          </Text>
        </View>
        <View style={[styles.stem, { borderTopColor: accentHex(accent) }]} />
        <View
          style={[
            styles.dot,
            { backgroundColor: accentHex(accent) },
            uncaught && styles.dotUncaught,
          ]}
        />
      </Animated.View>
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
    flexWrap: "wrap",
    columnGap: 8,
    rowGap: 6,
    paddingBottom: 6,
  },
  /** Shrinks before the title wraps; the action chips wrap to their own row instead. */
  sheetToggle: { flexDirection: "row", alignItems: "center", flexShrink: 1, gap: 6 },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    marginBottom: 6,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
  },
  sheetTitle: { color: colors.fg, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  /** Grows so the chips stay right-aligned whether or not they wrapped below the title. */
  sheetActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    flexGrow: 1,
    flexShrink: 1,
    columnGap: 10,
    rowGap: 6,
  },
  viewAsListBtn: { flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 4 },
  sheetSeeAll: { color: colors.accent, fontSize: 13, fontWeight: "700" },
  sheetEmpty: {
    color: colors.fgMuted,
    fontSize: 13,
    lineHeight: 18,
    paddingVertical: 8,
  },
  sheetError: {
    color: colors.warn,
    fontSize: 12,
    lineHeight: 17,
    paddingBottom: 6,
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
  sheetTickerUncaught: { color: colors.fgDim },
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
  notificationTargetWrap: {
    width: "100%",
    overflow: "hidden",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  notificationTargetCopy: { flexDirection: "row", alignItems: "center", gap: 7 },
  notificationTargetText: { color: colors.fg, flex: 1, fontSize: 12, lineHeight: 17 },
  notificationRetry: { minHeight: 44, justifyContent: "center", alignItems: "center" },
  notificationRetryText: { color: colors.accent, fontSize: 13, fontWeight: "700" },
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
    fontSize: 10,
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
  /**
   * Silhouette layer (roadmap B2) — uncaught investables. Canvas dimensions are
   * untouched; only ink changes, so the Google-provider anchor stays put.
   */
  silhouette: { opacity: 0.6 },
  bubbleUncaught: {
    backgroundColor: colors.bgSunken,
    borderColor: colors.borderStrong,
  },
  tickerTextUncaught: { color: colors.fgMuted },
  priceTextUncaught: { color: colors.fgDim },
  placeHintUncaught: { color: colors.fgDim },
  dotUncaught: { borderColor: colors.fgMuted },
  plainDotUncaught: { borderColor: colors.fgMuted },
  /** 18pt jade-ring camera badge — distinct from the 14pt filled nearby dots. */
  findBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
